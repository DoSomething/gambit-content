'use strict';

/**
 * Imports.
 */
const mongoose = require('mongoose');
const Promise = require('bluebird');
const logger = require('winston');
const superagent = require('superagent');

const helpers = rootRequire('lib/helpers');
const mobilecommons = rootRequire('lib/mobilecommons');
const northstar = require('../../lib/northstar');
const stathat = require('../../lib/stathat');
const zendesk = require('../../lib/zendesk');

/**
 * Schema.
 */
const userSchema = new mongoose.Schema({

  _id: { type: String, index: true },
  // TODO: Not sure we need this index
  mobile: { type: String, index: true },
  phoenix_id: Number,
  mobilecommons_id: Number,
  email: String,
  role: String,
  first_name: String,
  // Campaign the user is currently participating in via chatbot.
  current_campaign: Number,

});

/**
 * Parse given Northstar User for User model.
 */
function parseNorthstarUser(northstarUser) {
  const data = {
    _id: northstarUser.id,
    mobile: northstarUser.mobile,
    first_name: northstarUser.firstName,
    email: northstarUser.email,
    phoenix_id: northstarUser.drupalID,
    mobilecommons_id: northstarUser.mobilecommonsID,
    role: northstarUser.role,
  };

  return data;
}

/**
 * Query DS API for given User type/id and store.
 */
userSchema.statics.lookup = function (type, id) {
  const model = this;
  const statName = 'northstar: GET users';

  return new Promise((resolve, reject) => {
    logger.debug(`User.lookup(${type}, ${id})`);

    return northstar.Users.get(type, id)
      .then((northstarUser) => {
        stathat.postStat(`${statName} 200`);
        logger.debug('northstar.Users.lookup success');
        const userData = parseNorthstarUser(northstarUser);
        const query = { _id: userData._id };

        return model.findOneAndUpdate(query, userData, helpers.upsertOptions()).exec();
      })
      .then(userDoc => resolve(userDoc))
      .catch((err) => {
        stathat.postStatWithError(statName, err);
        const scope = err;
        scope.message = `User.lookup error:${err.message}`;

        return reject(scope);
      });
  });
};

/**
 * Post user to DS API.
 */
userSchema.statics.post = function (data) {
  const model = this;
  const statName = 'northstar: POST users';

  const createUser = data;
  createUser.source = process.env.DS_API_USER_REGISTRATION_SOURCE || 'sms';
  createUser.password = helpers.generatePassword(data.mobile);
  const emailDomain = process.env.DS_API_DEFAULT_USER_EMAIL || 'mobile.import';
  createUser.email = `${data.mobile}@${emailDomain}`;

  return new Promise((resolve, reject) => {
    logger.debug('User.post');

    return northstar.Users.create(createUser)
      .then((northstarUser) => {
        stathat.postStat(`${statName} 200`);
        logger.info(`northstar.Users created user:${northstarUser.id}`);
        const query = { _id: northstarUser.id };
        const userData = parseNorthstarUser(northstarUser);

        return model.findOneAndUpdate(query, userData, helpers.upsertOptions()).exec();
      })
      .then(userDoc => resolve(userDoc))
      .catch((err) => {
        stathat.postStatWithError(statName, err);
        const scope = err;
        scope.message = `User.post error:${err.message}`;

        return reject(scope);
      });
  });
};

/**
 * Updates MC Profile gambit_chatbot_response Custom Field with given msgTxt to deliver over SMS.
 * @param {number} oip - Opt-in Path ID of the Mobile Commons Opt-in Path that will send a message
 * @param {string} msgText - text message content to send to User
 */
userSchema.methods.postMobileCommonsProfileUpdate = function (oip, msgTxt) {
  const data = {
    // The MC Opt-in Path Conversation needs to render gambit_chatbot_response value as Liquid tag.
    // @see https://github.com/DoSomething/gambit/wiki/Chatbot#mobile-commons
    gambit_chatbot_response: msgTxt,
  };

  return mobilecommons.profile_update(this.mobilecommons_id, this.mobile, oip, data);
};

/**
 * Posts given messageText to the Dashbot API with given dashbotMessageType.
 * @see https://www.dashbot.io/sdk/generic.
 *
 * @param {number} dashbotMessageType - Expected values: 'incoming' | 'outgoing'
 * @param {string} messageText - text to track in Dashbot
 */
userSchema.methods.postDashbot = function (dashbotMessageType, messageText) {
  if (!process.env.DASHBOT_API_KEY) {
    return logger.warn('DASHBOT_API_KEY undefined');
  }

  const logMessage = `user.postDashbot:${dashbotMessageType} ${this._id}:${messageText}`;
  logger.debug(logMessage);

  const data = {
    userId: this._id,
    text: messageText,
  };

  return superagent
    .post('https://tracker.dashbot.io/track')
    .query({
      platform: 'generic',
      v: '0.8.2-rest', // eslint-disable-line id-length
      type: dashbotMessageType,
      apiKey: process.env.DASHBOT_API_KEY,
    })
    .send(data)
    .then(response => logger.debug(`dashbot response:${JSON.stringify(response.body)}`))
    .catch(err => logger.error(`dashbot response::${err.message}`));
};

userSchema.methods.postDashbotIncoming = function (message) {
  this.postDashbot('incoming', message);
};

userSchema.methods.postDashbotOutgoing = function (gambitMessageType) {
  this.postDashbot('outgoing', gambitMessageType);
};

/**
 * Posts given message to Zendesk on behalf of a User.
 * @param {string} message
 */
userSchema.methods.postZendeskMessage = function (message) {
  zendesk.getClient().tickets.create({
    requester: {
      phone: this.mobile,
      email: this.email,
    },
    subject: 'Sent from Gambit',
    comment: {
      body: message,
    },
  })
  .then(res => logger.debug(res.ticket))
  .catch(err => logger.error(err.message));
};

module.exports = mongoose.model('users', userSchema);
