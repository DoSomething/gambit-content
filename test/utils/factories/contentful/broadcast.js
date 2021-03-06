'use strict';

// TODO: Rename this file and these functions as legacyBroadcast.

const stubs = require('../../stubs');
const campaignFactory = require('./campaign');

module.exports.getValidCampaignBroadcast = function getValidCampaignBroadcast(date = Date.now()) {
  return {
    sys: stubs.contentful.getSysWithTypeAndDate('broadcast', date),
    fields: {
      name: stubs.getBroadcastName(),
      topic: null,
      message: stubs.getRandomMessageText(),
      template: 'askSignup',
      campaign: campaignFactory.getValidCampaign(),
      attachments: stubs.contentful.getAttachments(),
    },
  };
};

module.exports.getValidTopicBroadcast = function getValidTopicBroadcast(date = Date.now()) {
  const broadcast = module.exports.getValidCampaignBroadcast(date);
  broadcast.fields.topic = stubs.getRandomWord();
  broadcast.fields.campaign = null;
  broadcast.fields.template = null;
  return broadcast;
};
