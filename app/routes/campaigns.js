'use strict';

const express = require('express');
const router = express.Router(); // eslint-disable-line new-cap
const Promise = require('bluebird');
const UnprocessibleEntityError = require('../exceptions/UnprocessibleEntityError');

const contentful = require('../../lib/contentful');
const helpers = require('../../lib/helpers');
const mobilecommons = rootRequire('lib/mobilecommons');
const phoenix = require('../../lib/phoenix');
const logger = app.locals.logger;
const stathat = app.locals.stathat;

/**
 * Queries Phoenix and Contentful to add external properties to given campaign model.
 */
function fetchCampaign(campaignDoc) {
  const campaign = campaignDoc.formatApiResponse();

  return new Promise((resolve, reject) => {
    logger.debug(`fetchCampaign:${campaign.id}`);

    return phoenix.Campaigns.get(campaign.id)
      .then((phoenixCampaign) => {
        campaign.title = phoenixCampaign.title;
        campaign.status = phoenixCampaign.status;

        return contentful.fetchKeywordsForCampaignId(campaign.id);
      })
      .then((keywords) => {
        campaign.keywords = keywords;

        return resolve(campaign);
      })
      .catch(error => reject(error));
  });
}

/**
 * GET index of campaigns.
 */
router.get('/', (req, res) => {
  stathat('route: v1/campaigns');

  const findClause = {};
  if (req.query.campaignbot) {
    const campaignConfigVar = process.env.CAMPAIGNBOT_CAMPAIGNS;
    const campaignIDs = campaignConfigVar.split(',').map(id => Number(id));
    findClause._id = { $in: campaignIDs };
  }

  return app.locals.db.campaigns
    .find(findClause)
    .exec()
    .then(campaignDocs => Promise.map(campaignDocs, fetchCampaign))
    .then(data => res.send({ data }))
    .catch(error => helpers.sendResponse(res, 500, error.message));
});

/**
 * GET single campaign.
 */
router.get('/:id', (req, res) => {
  stathat('route: v1/campaigns/{id}');
  const campaignId = req.params.id;
  logger.debug(`get campaign ${campaignId}`);

  return app.locals.db.campaigns
    .findById(campaignId)
    .exec()
    .then(campaignDoc => {
      if (!campaignDoc) {
        return helpers.sendResponse(res, 404, `Campaign ${campaignId} not found`);
      }

      return fetchCampaign(campaignDoc);
    })
    .then(data => res.send({ data }))
    .catch(error => helpers.sendResponse(res, 500, error.message));
});

/**
 * Sends SMS message to given phone number with the given Campaign and its message type.
 */
router.post('/:id/message', (req, res) => {
  // Check required parameters.
  const campaignId = req.params.id;
  const phone = req.body.phone;
  const type = req.body.type;

  if (!campaignId) {
    return helpers.sendResponse(res, 422, 'Missing required campaign id.');
  }
  if (!phone) {
    return helpers.sendResponse(res, 422, 'Missing required phone parameter.');
  }
  if (!type) {
    return helpers.sendResponse(res, 422, 'Missing required message type parameter.');
  }

  if (!helpers.isCampaignBotCampaign(campaignId)) {
    const msg = `Campaign ${campaignId} is not running on CampaignBot`;
    return helpers.sendResponse(res, 422, msg);
  }

  const loadCampaignMessage = new Promise((resolve, reject) => {
    logger.debug(`loadCampaignMessage campaign:${campaignId} msgType:${type}`);

    return phoenix.Campaigns.get(campaignId)
      .then((phoenixCampaign) => {
        logger.debug(`phoenix.Campaigns.get found campaign:${campaignId}`);

        if (phoenixCampaign.status === 'closed') {
          const msg = `Campaign ${campaignId} is closed.`;
          const err = new UnprocessibleEntityError(msg);
          return reject(err);
        }

        return contentful.fetchMessageForPhoenixCampaign(phoenixCampaign, type);
      })
      .then(message => resolve(message))
      .catch(err => reject(err));
  });

  return loadCampaignMessage
    .then((messageBody) => {
      mobilecommons.send_message(phone, messageBody);
      const msg = `Sent text for ${campaignId} ${type} to ${phone}`;
      logger.info(msg);
      stathat('Sent campaign message');

      return helpers.sendResponse(res, 200, msg);
    })
    .catch(UnprocessibleEntityError, (err) => {
      logger.error(err.message);

      return helpers.sendResponse(res, 422, err.message);
    })
    .catch((err) => {
      if (err.response) {
        logger.error(err.response.error);
      }
      const msg = `Error sending text to user #${phone}: ${err.message}`;

      return helpers.sendResponse(res, 500, msg);
    });
});

module.exports = router;
