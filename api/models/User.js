'use strict';

/**
 * Imports.
 */
const mongoose = require('mongoose');
const Promise = require('bluebird');

const logger = app.locals.logger;

/**
 * Schema.
 */
const userSchema = new mongoose.Schema({

  _id: { type: String, index: true },
  // TODO: Not sure we need this index
  mobile: { type: String, index: true },
  phoenix_id: Number,
  email: String,
  role: String,
  first_name: String,
  // Hash table to store current signups: e.g. campaigns[campaignId] = signupId;
  campaigns: { type: mongoose.Schema.Types.Mixed, default: {} },
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
    role: northstarUser.role,
  };

  return data;
}

/**
 * Query DS API for given User type/id and store.
 */
userSchema.statics.lookup = function (type, id) {
  const model = this;

  return new Promise((resolve, reject) => {
    logger.debug(`User.lookup type:${type} id:${id}`);

    return app.locals.clients.northstar.Users
      .get(type, id)
      .then((northstarUser) => {
        logger.debug('northstar.Users.lookup success');
        const data = parseNorthstarUser(northstarUser);

        return model
          .findOneAndUpdate({ _id: data._id }, data, { upsert: true, new: true })
          .exec()
          .then(user => resolve(user))
          .catch(error => reject(error));
      })
      .catch((error) => reject(error));
  });
};

/**
 * Post user to DS API.
 */
userSchema.statics.post = function (newUser) {
  const model = this;

  return new Promise((resolve, reject) => {
    logger.debug(`User.post data:${JSON.stringify(newUser)}`);

    return app.locals.clients.northstar.Users
      .create(newUser)
      .then((northstarUser) => {
        logger.info(`northstar.Users created user:${northstarUser.id}`);
        const data = parseNorthstarUser(northstarUser);

        return model
          .findOneAndUpdate({ _id: data._id }, data, { upsert: true, new: true })
          .exec()
          .then(user => resolve(user))
          .catch(error => reject(error));
      })
      .catch(error => reject(error));
  });
};

/**
 * Set given signup on user's campaigns hash map, sets signup.campaign to user.current_campaign.
 */
userSchema.methods.setCurrentCampaign = function (signup) {
  const user = this;

  return new Promise((resolve, reject) => {
    logger.debug(`setCurrentSignup user:${user._id} campaigns[${signup.campaign}]:${signup.id}`);

    user.campaigns[signup.campaign] = signup.id;
    user.current_campaign = signup.campaign;
    return user.save()
      .then(updatedUser => resolve(updatedUser))
      .catch(error => reject(error));
  });
};

module.exports = function (connection) {
  return connection.model('users', userSchema);
};
