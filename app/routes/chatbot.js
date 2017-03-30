'use strict';

/**
 * Imports.
 */
const express = require('express');
const router = express.Router(); // eslint-disable-line new-cap
const logger = app.locals.logger;
const stathat = app.locals.stathat;
const Promise = require('bluebird');
const CampaignBotController = require('../controllers/CampaignBotController');
const controller = new CampaignBotController();
const helpers = require('../../lib/helpers');
const contentful = require('../../lib/contentful');
const newrelic = require('newrelic');
const mobilecommons = require('../../lib/mobilecommons');
const phoenix = require('../../lib/phoenix');
const ClosedCampaignError = require('../exceptions/ClosedCampaignError');
const NotFoundError = require('../exceptions/NotFoundError');
// Models.
const BotRequest = require('../models/BotRequest');
const Signup = require('../models/Signup');
const User = require('../models/User');


/**
 * Determines if given incomingMessage matches given Gambit command type.
 */
function isCommand(incomingMessage, commandType) {
  logger.debug(`isCommand:${commandType}`);

  if (!incomingMessage) {
    return false;
  }

  const firstWord = helpers.getFirstWord(incomingMessage).toUpperCase();
  const configName = `GAMBIT_CMD_${commandType.toUpperCase()}`;
  const configValue = process.env[configName];
  const result = firstWord === configValue.toUpperCase();

  return result;
}

/**
 * Posts to chatbot route will find or create a Northstar User for the given req.body.phone.
 * Currently only supports Mobile Commons mData's.
 */
router.post('/', (req, res) => {
  stathat('route: v1/chatbot');

  const scope = req;
  // Currently only support mobilecommons.
  scope.client = 'mobilecommons';
  // TODO: Define this in app.locals to DRY with routes/signups
  scope.oip = process.env.MOBILECOMMONS_OIP_CHATBOT;
  const agentViewOip = process.env.MOBILECOMMONS_OIP_AGENTVIEW;
  scope.incoming_message = req.body.args;
  scope.incoming_image_url = req.body.mms_image_url;

  if (req.body.broadcast_id) {
    scope.broadcast_id = req.body.broadcast_id;
  }

  if (req.body.keyword) {
    scope.keyword = req.body.keyword.toLowerCase();
    logger.debug(`keyword:${scope.keyword}`);
  }

  newrelic.addCustomParameters({
    incomingImageUrl: scope.incoming_image_url,
    incomingMessage: scope.incoming_message,
    keyword: scope.keyword,
    mobileCommonsBroadcastId: scope.broadcast_id,
    mobileCommonsMessageId: scope.body.message_id,
    mobileCommonsProfileId: req.body.profile_id,
  });

  let currentBotRequest;
  BotRequest.log(req, 'chatbot')
    .then((botRequestDoc) => {
      currentBotRequest = botRequestDoc;
      const id = botRequestDoc._id.toString();
      logger.info(`created botRequest:${id} data:${JSON.stringify(currentBotRequest.body)}`);

      return helpers.sendResponse(res, 200, `Queued request:${id}`);
    })
    .catch(err => helpers.sendResponse(res, 500, err.message));

  /**
   * Begin processing incoming request by loading DS User for given mobile number.
   */
  const loadUser = new Promise((resolve, reject) => {
    logger.log('loadUser');

    return User.lookup('mobile', req.body.phone)
      .then(user => resolve(user))
      .catch((err) => {
        if (err && err.status === 404) {
          logger.info(`User.lookup could not find mobile:${req.body.phone}`);

          const user = User.post({
            mobile: req.body.phone,
            mobilecommons_id: req.profile_id,
          });
          return resolve(user);
        }

        return reject(err);
      });
  });

  const loadCampaign = new Promise((resolve, reject) => {
    logger.log('loadCampaign');
    let currentBroadcast;

    return loadUser
      .then((user) => {
        logger.info(`loaded user:${user._id}`);
        scope.user = user;
        newrelic.addCustomParameters({ userId: user._id });
        currentBotRequest.user_id = scope.user._id;

        if (scope.broadcast_id) {
          return contentful.fetchBroadcast(scope.broadcast_id)
            .then((broadcast) => {
              if (!broadcast) {
                const err = new NotFoundError(`broadcast ${scope.broadcast_id} not found`);
                return reject(err);
              }
              logger.debug(`found broadcast:${JSON.stringify(broadcast)}`);
              currentBroadcast = broadcast;
              logger.info(`loaded broadcast:${scope.broadcast_id}`);
              const campaignId = currentBroadcast.fields.campaign.fields.campaignId;

              return phoenix.fetchCampaign(campaignId);
            })
            .then((campaign) => {
              if (!campaign.id) {
                const err = new Error('broadcast campaign undefined');
                return reject(err);
              }

              logger.info(`loaded campaign:${campaign.id}`);

              scope.broadcast = currentBroadcast;
              const saidNo = !(req.incoming_message && helpers.isYesResponse(req.incoming_message));
              if (saidNo) {
                const err = new Error('broadcast declined');
                return reject(err);
              }

              return resolve(campaign);
            })
            .catch(err => reject(err));
        }

        if (scope.keyword) {
          return contentful.fetchKeyword(scope.keyword)
            .then((keyword) => {
              if (!keyword) {
                const err = new NotFoundError(`keyword ${scope.keyword} not found`);
                return reject(err);
              }
              logger.debug(`found keyword:${JSON.stringify(keyword.fields)}`);

              if (keyword.fields.environment !== process.env.NODE_ENV) {
                let msg = `mData misconfiguration: ${keyword.environment} keyword sent to`;
                msg = `${msg} ${process.env.NODE_ENV}`;
                const err = new Error(msg);
                return reject(err);
              }
              const campaignId = keyword.fields.campaign.fields.campaignId;
              logger.debug(`keyword campaignId:${campaignId}`);

              return phoenix.fetchCampaign(campaignId);
            })
            .then((campaign) => {
              if (!campaign.id) {
                const msg = `Campaign not found for keyword '${scope.keyword}'.`;
                const err = new NotFoundError(msg);
                return reject(err);
              }
              logger.debug(`found campaign:${campaign.id}`);

              return resolve(campaign);
            })
            .catch(err => reject(err));
        }

        // If we've made it this far, check for User's current_campaign.
        logger.debug(`user.current_campaign:${user.current_campaign}`);
        return phoenix.fetchCampaign(user.current_campaign)
          .then((campaign) => {
            if (!campaign.id) {
              // TODO: Send to non-existent start menu to select a campaign.
              const msg = `User ${user._id} current_campaign ${user.current_campaign} not found.`;
              const err = new NotFoundError(msg);

              return reject(err);
            }

            return resolve(campaign);
          });
      })
      .catch(err => reject(err));
  });

  return loadCampaign
    .then((campaign) => {
      scope.campaign = campaign;
      newrelic.addCustomParameters({ campaignId: campaign.id });
      currentBotRequest.campaign_id = scope.campaign.id;

      if (phoenix.isClosedCampaign(campaign)) {
        throw new ClosedCampaignError(campaign);
      }

      return Signup.lookupCurrent(scope.user, scope.campaign);
    })
    .then((currentSignup) => {
      if (currentSignup) {
        logger.debug(`Signup.lookupCurrent found signup:${currentSignup._id}`);

        return currentSignup;
      }
      logger.debug('Signup.lookupCurrent not find signup');

      return Signup.post(scope.user, scope.campaign, scope.keyword);
    })
    .then((signup) => {
      logger.info(`loaded signup:${signup._id.toString()}`);
      scope.signup = signup;
      newrelic.addCustomParameters({ signupId: signup._id });

      if (!scope.signup) {
        // TODO: Handle this edge-case.
        logger.error('signup undefined');
        return false;
      }

      if (scope.broadcast_id) {
        scope.signup.broadcast_id = scope.broadcast_id;
        scope.signup.save().catch((err) => logger.error('Error saving broadcast id', err.message));
      }

      if (isCommand(scope.incoming_message, 'member_support')) {
        scope.cmd_member_support = true;
        scope.oip = agentViewOip;
        return 'member_support';
      }

      if (scope.signup.draft_reportback_submission) {
        logger.debug(`draft_reportback_submission:${scope.signup.draft_reportback_submission._id}`);
        return controller.continueReportbackSubmission(scope);
      }

      if (isCommand(scope.incoming_message, 'reportback')) {
        return scope.signup.createDraftReportbackSubmission().then(() => 'ask_quantity');
      }

      if (scope.signup.reportback) {
        if (scope.keyword || scope.broadcast_id) {
          return 'menu_completed';
        }
        // If we're this far, member didn't text back Reportback or Member Support commands.
        return 'invalid_cmd_completed';
      }

      if (scope.keyword || scope.broadcast_id) {
        return 'menu_signedup_gambit';
      }

      return 'invalid_cmd_signedup';
    })
    .then((msgType) => {
      // This is hacky, CampaignBotController.postReportback returns error that isn't caught.
      // TODO: Clean this up when ready to take on https://github.com/DoSomething/gambit/issues/744.
      if (msgType instanceof Error) {
        throw new Error(msgType.message);
      }

      scope.msg_type = msgType;
      // TODO: Add config variable for invalid text input copy.
      scope.msg_prefix = 'Sorry, I didn\'t understand that.\n\n';

      if (scope.msg_type === 'invalid_caption') {
        scope.msg_type = 'ask_caption';
      } else if (scope.msg_type === 'invalid_why_participated') {
        scope.msg_type = 'ask_why_participated';
      } else {
        scope.msg_prefix = '';
      }
      return contentful.renderMessageForPhoenixCampaign(scope.campaign, scope.msg_type);
    })
    .then((renderedMessage) => {
      scope.response_message = `${scope.msg_prefix} ${renderedMessage}`;
      newrelic.addCustomParameters({ gambitResponseMessageType: scope.msg_type });

      let quantity = req.signup.total_quantity_submitted;
      if (req.signup.draft_reportback_submission) {
        quantity = req.signup.draft_reportback_submission.quantity;
      }
      scope.response_message = scope.response_message.replace(/{{quantity}}/gi, quantity);
      const revisiting = req.keyword && req.signup.draft_reportback_submission;
      if (revisiting) {
        // TODO: Add config variable for continue draft message copy.
        const continueMsg = 'Picking up where you left off on';
        const campaignTitle = scope.campaign.title;
        scope.response_message = `${continueMsg} ${campaignTitle}...\n\n${scope.response_message}`;
      }
      // Save to continue conversation with future mData requests that don't contain a keyword.
      scope.user.current_campaign = scope.campaign.id;

      return scope.user.save();
    })
    .then(() => {
      scope.response_message = helpers.addSenderPrefix(scope.response_message);
      currentBotRequest.bot_response_type = scope.msg_type;
      currentBotRequest.bot_response_message = scope.response_message;
      logger.debug(`saved user.current_campaign:${scope.campaign.id}`);

      scope.user.postMobileCommonsProfileUpdate(scope.oip, scope.response_message);
      stathat(`campaignbot:${scope.msg_type}`);

      return currentBotRequest.save();
    })
    .then(botRequest => logger.debug(`updated botRequest:${botRequest._id}`))
    .catch(NotFoundError, (err) => {
      logger.error(err.message);

      // TODO: Add a new errorOccurredMessage field to Contentful campaigns to reply with.
      scope.user.postMobileCommonsProfileUpdate(scope.oip, err.message);
      return currentBotRequest.save();
    })
    .catch(ClosedCampaignError, (err) => {
      logger.warn(err.message);
      stathat('campaign closed');

      return contentful.renderMessageForPhoenixCampaign(scope.campaign, 'campaign_closed')
        .then((responseMessage) => {
          scope.response_message = helpers.addSenderPrefix(responseMessage);

          // Send to Agent View for now until we get a Select Campaign menu up and running.
          scope.user.postMobileCommonsProfileUpdate(agentViewOip, scope.response_message);
          return currentBotRequest.save();
        })
        .catch((renderError) => {
          logger.error(renderError.message);

          scope.user.postMobileCommonsProfileUpdate(agentViewOip, renderError.message);
          return currentBotRequest.save();
        });
    })
    .catch(err => {
      if (err.message === 'broadcast declined') {
        logger.info('broadcast declined');
        scope.response_message = scope.broadcast.fields.declinedMessage;
        if (!scope.response_message) {
          const logMsg = 'undefined broadcast.declinedMessage';
          logger.error(logMsg);
          stathat(`error: ${logMsg}`);
        }
        const msg = helpers.addSenderPrefix(scope.response_message);

        // Log the no response:
        currentBotRequest.bot_response_type = 'prompt_declined';
        currentBotRequest.bot_response_message = msg;

        // Send broadcast declined using Mobile Commons Send Message API:
        mobilecommons.send_message(scope.user.mobile, msg);

        return currentBotRequest.save();
      }

      // If an error occurrs -- do we even need to let the user know?
      // If so we'll need to call user.postMobileCommonsProfileUpdate().

      stathat(err.message);
      return logger.error(err.message);
    });
});

module.exports = router;
