"use strict";

var logger = rootRequire('lib/logger');
var mobilecommons = rootRequire('lib/mobilecommons');
var phoenix = rootRequire('lib/phoenix')();
var helpers = rootRequire('lib/helpers');

var connOps = rootRequire('config/connectionOperations');
var reportbackSubmissions = require('../models/campaign/ReportbackSubmission')(connOps);
var signups = require('../models/campaign/Signup')(connOps);
var users = require('../models/User')(connOps);

var START_RB_COMMAND = 'next';

/**
 * CampaignBotController
 * @constructor
 * @param {integer} campaignId - our DS Campaign ID
 */
function CampaignBotController(campaignId) {
  this.campaign = app.getConfig(app.ConfigName.CAMPAIGNS, campaignId);
};

/**
 * Chatbot endpoint for DS Campaign Signup and Reportback.
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
CampaignBotController.prototype.chatbot = function(request, response) {
  var self = this;

  if (!self.campaign) {
    response.sendStatus(500);
    return;
  }
  response.send();

  // Load our current user document (creates first if document not found).
  users.findOne({ '_id': request.user_id }, function (err, user) {

    if (err) {
      logger.error(err);
      return;
    }

    if (!user) {

      users.create({

        _id: request.user_id,
        mobile: request.user_id,
        campaigns: {}

      }).then(function(newUser) {

        self.user = newUser;
        logger.debug('campaignBot created user._id:%', newUser['_id']);

        // Assuming our user hasn't signed up on web first for now.
        // @todo: Eventually need to safetycheck by querying for DS Signups API
        self.sendSignupSuccessMsg();

      });

      return;
    }

    self.user = user;
    logger.debug('campaignBot found user:%s', self.user._id);

    // Load our current User's Signup for this Campaign.
    if (self.user.campaigns[self.campaign._id]) {

      var signupId = self.user.campaigns[self.campaign._id];
      
      signups.findOne({ '_id': signupId }, function (err, signupDoc) {

        if (err) {
          logger.error(err);
        }

        self.signup = signupDoc;
        logger.debug('self.signup:%s', self.signup._id.toString());
  
      });

    }

    self.incomingMsg = request.incoming_message;
    if (self.incomingMsg) {
      self.incomingMsg = self.incomingMsg.toLowerCase();
    }

    if (request.query.start || !self.incomingMsg)  {
      self.postSignup();
      return;
    }

    if (!self.supportsMMS()) {
      return;
    }

    self.chatReportback();

  });
  
}

CampaignBotController.prototype.chatReportback = function(isNewSubmission) {
  var self = this;

  if (self.incomingMsg === START_RB_COMMAND || isNewSubmission === true) {
    self.sendAskQuantityMessage();
    return;
  }

  var quantity = self.incomingMsg;
  if (helpers.hasLetters(quantity) || !parseInt(quantity)) {
    self.sendMessage('@stg: Please provide a valid number.');
    return;
  }
  
  reportbackSubmissions.create({

    campaign: self.campaign._id,
    user: self.user._id,
    quantity: quantity

  }).then(function(reportbackSubmission) {

    // @todo Add error handler in case of failed write
    self.sendReportbackSuccessMsg(quantity);
    logger.debug('campaignBot created reportbackSubmission._id:%s', 
      reportbackSubmission['_id']);

  });

}

CampaignBotController.prototype.supportsMMS = function() {
  var self = this;

  if (self.user.supports_mms === true) {
    return true;
  }

  if (self.incomingMsg === START_RB_COMMAND || !self.incomingMsg) {
    self.sendMessage('@stg: Can you send photos from your phone?');
    return false;
  }
  
  if (!helpers.isYesResponse(self.incomingMsg)) {
    self.sendMessage('@stg: Sorry, you must submit a photo to complete.');
    return false;
  }

  self.user.supports_mms = true;
  self.user.save(function(err) {
    if (err) {
      // @todo
      // return handleError(err);
    }
    self.chatReportback(true);
    return true;
  });

};

CampaignBotController.prototype.postSignup = function() {
  var self = this;
  var campaignId = self.campaign._id;

  // @todo Query DS API to check if Signup exists, post to API to get _id if not
  signups.create({

    campaign: campaignId,
    user: self.user._id

  }).then(function(signupDoc) {

    // Store signup ID in our user's campaigns for easy lookup.
    self.user.campaigns[campaignId] = signupDoc._id;
    self.user.markModified('campaigns');

    self.user.save(function(err) {
      if (err) {
        logger.error(err);
      }
      self.sendSignupSuccessMsg();
    });

  });
}

CampaignBotController.prototype.sendAskQuantityMessage = function() {
  var msgTxt = '@stg: What`s the total number of ' + this.campaign.rb_noun;
  msgTxt += ' you ' + this.campaign.rb_verb + '?';
  msgTxt += '\n\nPlease text the exact number back.';
  this.sendMessage(msgTxt);
}

CampaignBotController.prototype.sendSignupSuccessMsg = function() {
  var msgTxt = '@stg: You\'re signed up for ' + this.campaign.title + '.\n\n';
  msgTxt += 'When you have ' + this.campaign.rb_verb + ' some ';
  msgTxt += this.campaign.rb_noun + ', text back ' + START_RB_COMMAND.toUpperCase();
  this.sendMessage(msgTxt);
}

CampaignBotController.prototype.sendReportbackSuccessMsg = function(quantity) {
  var msgTxt = '@stg: Got you down for ' + quantity;
  msgTxt += ' ' + this.campaign.rb_noun + ' ' + this.campaign.rb_verb + '.';
  msgTxt += '\n---\nKeep it up! If you\'ve ' + this.campaign.rb_verb + ' any more ';
  msgTxt += this.campaign.rb_noun + ', reply back with ';
  msgTxt += START_RB_COMMAND.toUpperCase();
  this.sendMessage(msgTxt);
}

CampaignBotController.prototype.sendMessage = function(msgTxt) {
  var mobileCommonsProfile = {
    phone: this.user.mobile
  };
  mobilecommons.chatbot(mobileCommonsProfile, 213849, msgTxt);
}

module.exports = CampaignBotController;
