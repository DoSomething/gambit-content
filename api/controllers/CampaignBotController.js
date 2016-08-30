"use strict";

var logger = rootRequire('lib/logger');
var mobilecommons = rootRequire('lib/mobilecommons');
var phoenix = rootRequire('lib/phoenix')();

var connOps = rootRequire('config/connectionOperations');
var reportbackSubmissions = require('../models/ReportbackSubmission')(connOps);
var users = require('../models/User')(connOps);

/**
 * CampaignBotController
 * @constructor
 * @param {integer} campaignId - our DS Campaign ID
 */
function CampaignBotController(campaignId) {
  this.campaignId = campaignId;
  this.campaign = app.getConfig(app.ConfigName.CAMPAIGNS, campaignId);
};

/**
 * Chatbot endpoint for DS Campaign Signup and Reportback.
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
CampaignBotController.prototype.chatbot = function(request, response) {
  var self = this;
  var member = request.body;

  if (!this.campaign) {
    response.sendStatus(500);
    return;
  }
  response.send();

  users.findOne({ '_id': member.phone }, function (err, userDoc) {

    if (err) {
      logger.error(err);
      return;
    }

    var msgTxt;

    if (!userDoc) {
      users.create({
        _id: member.phone,
        first_name: member.profile_first_name,
        mobile: member.phone
      }).then(function(doc) {
        logger.debug('campaignBot created user._id:%', doc['_id']);
      });
      // @todo: Eventually need to safetycheck by querying for Signup from DS API
      msgTxt = self.getSignupConfirmMessage(campaign);
    }

    else {
      logger.debug('campaignBot found user:%s', userDoc._id);
      if (request.query.start || !request.body.args)  {
        msgTxt = self.getSignupConfirmMessage();
      }
      else {
        var quantity = parseInt(request.body.args);
        msgTxt = self.getReportbackConfirmMessage(quantity);

        reportbackSubmissions.create({
          campaign: self.campaignId,
          mobile: member.phone,
          quantity: quantity
        }).then(function(doc) {
          logger.debug('campaignBot created reportbackSubmission._id:%s for:%s', 
            doc['_id'], submission);
        });
      }
    }

    sendMessage(member, msgTxt);

  });
  
}


CampaignBotController.prototype.getSignupConfirmMessage = function() {
  var msgTxt = '@stg: You\'re signed up for ' + this.campaign.title + '.\n\n';
  msgTxt += 'When completed, text back the total number of ' + this.campaign.rb_noun;
  msgTxt += ' you have ' + this.campaign.rb_verb + ' so far.';
  return msgTxt;
}

CampaignBotController.prototype.getReportbackConfirmMessage = function(quantity) {
  var msgTxt = '@stg: Got you down for ' + quantity;
  msgTxt += ' ' + this.campaign.rb_noun + ' ' + this.campaign.rb_verb + '.';
  return msgTxt;
}

function sendMessage(mobileCommonsProfile, msgTxt) {
  mobilecommons.chatbot(mobileCommonsProfile, 213849, msgTxt);
}

module.exports = CampaignBotController;
