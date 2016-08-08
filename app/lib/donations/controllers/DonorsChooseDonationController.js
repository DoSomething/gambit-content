"use strict";

/**
 * Donors Choose implementation of the donation interface.
 *
 * The flow a user should be guided through:
 *   1. start
 *      - sends the appropriate optin path to start the donation
 *      - unless a max number of donations have been made, then a message
 *        is sent to notify the user about that
 *      - calls findProject to respond to user with project details
 *        and ask for their first name
 *   2. retrieveFirstName
 *   3. retrieveEmail
 *      - will call submitDonation
 *        submitDonation responsible for responding to user with success message
 */

var donorsChooseApiKey = (process.env.DONORSCHOOSE_API_KEY || 'DONORSCHOOSE')
  , donorsChooseApiPassword = (process.env.DONORSCHOOSE_API_PASSWORD || 'helpClassrooms!')
  , donorsChooseDonationBaseURL = 'https://apisecure.donorschoose.org/common/json_api.html?'
  , donorsChooseProposalsQueryBaseURL = 'https://api.donorschoose.org/common/json_feed.html'
  , defaultDonorsChooseTransactionEmail = (process.env.DONORSCHOOSE_DEFAULT_EMAIL || null);

if (process.env.NODE_ENV != 'production') {
  donorsChooseProposalsQueryBaseURL = 'https://qa.donorschoose.org/common/json_feed.html';
  donorsChooseDonationBaseURL = 'https://apiqasecure.donorschoose.org/common/json_api.html';
}

var TYPE_OF_LOCATION_WE_ARE_QUERYING_FOR = 'zip' // 'zip' or 'state'. Our retrieveLocation() function will adjust accordingly.
  , DONATION_AMOUNT = (process.env.DONORSCHOOSE_DONATION_AMOUNT || 10)
  , COST_TO_COMPLETE_UPPER_LIMIT = 10000
  , DONATE_API_URL = donorsChooseDonationBaseURL + '?APIKey=' + donorsChooseApiKey
  , END_MESSAGE_DELAY = 2500;

var Q = require('q')
  , requestHttp = require('request')
  , Entities = require('html-entities').AllHtmlEntities
  , logger = rootRequire('app/lib/logger')
  , mobilecommons = rootRequire('mobilecommons')
  , smsHelper = rootRequire('app/lib/smsHelpers')
  , shortenLink = rootRequire('app/lib/bitly')
  , stringValidator = rootRequire('app/lib/string-validators')
  ;

var connectionOperations = rootRequire('app/config/connectionOperations')
  , donationModel = require('../models/DonationInfo')(connectionOperations)
  , userModel = rootRequire('app/lib/sms-games/models/sgUser')(connectionOperations)
  ;

// @TODO: add some kind of reference to retrieve the donations config 
// var donationConfigModel = require('../')
var donationConfigId = (process.env.DONORSCHOOSE_CONFIG_ID || 201);

function DonorsChooseDonationController() {
  this.host; // Used to store reference to application host.
  this.resourceName; // Resource name identifier. Specifies controller to route. 
};

/**
 * Resource name identifier. Routes will use this to specify the controller to use.
 */
DonorsChooseDonationController.prototype.resourceName = 'donors-choose';

/**
 * Optional method to start the donation flow. Validates that this user is
 * allowed to make a donation.
 *
 * @param request
 *   Express Request object
 * @param response
 *   Express Response object
 */
DonorsChooseDonationController.prototype.start = function(request, response) {
  var self = this;

  var phone = smsHelper.getNormalizedPhone(request.body.phone);
  userModel.findOne({phone: phone}, onUserFound);
  response.send();

  function onUserFound(err, doc) {
    logger.log('debug', 'DonorsChoose.onUserFound:%s', JSON.stringify(doc));

    var config;
    var donationsCount;
    var i;

    if (err) {
      logger.error('DonorsChoose.onUserFound err:%s', JSON.stringify(err));
    }

    donationsCount = 0;
    if (doc && doc.donations) {
      for (i = 0; i < doc.donations.length; i++) {
        // Check for number of donations from this specific Donation Flow config/campaign.
        if (donationConfigId == doc.donations[i].config_id) {
          donationsCount = doc.donations[i].count;
          break;
        }
      }
    }

    config = app.getConfig(app.ConfigName.DONORSCHOOSE, donationConfigId);

    // If user has not hit the max limit, start the donation flow.
    if (!config.max_donations_allowed || donationsCount <= config.max_donations_allowed) {
      self.findProject(phone, config);
    }
    // Otherwise, send an error message
    else {
      sendSMS(phone, config.max_donations_reached_oip);
    }
  }
};

/**
 * Queries DonorsChoose API to find a project and sends the
 * project details back to the user.
 *
 * @see https://data.donorschoose.org/docs/project-listing/json-requests/
 *
 * @param mobileNumber
 *   User's mobile number
 * @param config
 *   Loaded donorschoose config document.
 */
DonorsChooseDonationController.prototype.findProject = function(mobileNumber, config) {
  var requestUrlString = donorsChooseProposalsQueryBaseURL;
  requestUrlString += '?subject4=-4'; 
  requestUrlString += '&sortBy=2'; 
  requestUrlString += '&costToCompleteRange=' + DONATION_AMOUNT + '+TO+' + COST_TO_COMPLETE_UPPER_LIMIT; 
  requestUrlString += '&max=1';
  requestUrlString += '&APIKey=' + donorsChooseApiKey;
  logger.log('debug', 'DonorsChoose.findProject request:%s', requestUrlString);

  requestHttp.get(requestUrlString, function(error, response, data) {
    if (!error) {
      var donorsChooseResponse;
      try {
        donorsChooseResponse = JSON.parse(data);
        if (!donorsChooseResponse.proposals || donorsChooseResponse.proposals.length == 0) {
          throw new Error('No proposals returned from Donors Choose');
        }
        else {
          var selectedProposal = donorsChooseResponse.proposals[0];
        }    
      }
      catch (e) {
        sendSMS(mobileNumber, config.error_start_again);
        // JSON.parse will throw a SyntaxError exception if data is not valid JSON
        logger.error('DonorsChoose.findProject invalid JSON data received from DonorsChoose API for user: ' 
          + mobileNumber + ' , or selected proposal does not contain necessary fields. Error: ' + e);
        return;
      }

      if (selectedProposal) {
        var entities = new Entities(); // Calling 'html-entities' module to decode escaped characters.
        var location = entities.decode(selectedProposal.city) + ', ' + entities.decode(selectedProposal.state)

        var mobileCommonsCustomFields = {
          SS_fulfillment_trailer:   entities.decode(selectedProposal.fulfillmentTrailer), 
          SS_teacher_name :         entities.decode(selectedProposal.teacherName), 
          SS_school_name :          entities.decode(selectedProposal.schoolName),
          SS_proj_location:         location
        };
      }
      else {
        sendSMS(mobileNumber, config.error_direct_user_to_restart);
        logger.error('DonorsChoose.findProject API response for user:' + mobileNumber 
          + ' has not returned with a valid proposal. response:'  + donorsChooseResponse);
        return;
      }

      // Email and first_name can be overwritten later. Included in case of error, transaction can still be completed. 
      var currentDonationInfo = {
        mobile: mobileNumber,
        email: 'donorschoose@dosomething.org', 
        first_name: 'Anonymous',
        location: location,
        project_id: selectedProposal.id,
        project_url: selectedProposal.proposalURL,
        donation_complete: false
      }

      // .profile_update call placed within the donationModel.create() callback to 
      // ensure that the ORIGINAL DOCUMENT IS CREATED before the user texts back 
      // their email address and attempts to find the document to be updated. 
      donationModel.create(currentDonationInfo).then(function(doc) {
        logger.log('debug', 'DonorsChoose.findProject created donation_infos document:%s for user:%s', JSON.stringify(doc), mobileNumber);
        mobilecommons.profile_update(mobileNumber, config.start_donation_flow, mobileCommonsCustomFields); // Arguments: phone, optInPathId, customFields.
      }, promiseErrorCallback('DonorsChoose.findProject unable to create donation_infos document for user: ' + mobileNumber));
    }
    else {
      sendSMS(mobileNumber, config.error_direct_user_to_restart);
      logger.error('DonorsChoose.findProject error for user:' + mobileNumber 
        + ' in retrieving proposal info from DonorsChoose or in uploading to MobileCommons custom fields: ' + error);
      return;
    }
  });
}

/**
 * Retrieves the user's first name to submit with the donation transaction.
 *
 * @param request
 *   Express Request object
 * @param response
 *   Express Response object
 */
DonorsChooseDonationController.prototype.retrieveFirstName = function(request, response) {
  var config = app.getConfig(app.ConfigName.DONORSCHOOSE, donationConfigId);
  var userSubmittedName = smsHelper.getFirstWord(request.body.args);
  var mobile = smsHelper.getNormalizedPhone(request.body.phone);
  logger.log('debug', 'DonorsChoose.retrieveFirstName:%s for user:%s', userSubmittedName, mobile);

  if (stringValidator.containsNaughtyWords(userSubmittedName) || !userSubmittedName) {
    userSubmittedName = 'Anonymous';
    logger.log('debug', 'DonorsChoose.retrieveFirstName set to %s for user:%s', userSubmittedName, mobile);
  }

  donationModel.findOneAndUpdate(
    {
      $and : [
        { mobile: mobile },
        { donation_complete: false }
      ]
    },
    {$set: {
      first_name: userSubmittedName
    }},
    function(err, num, raw) {
      if (err) {
        logger.error('Error in retrieving first name of user for user mobile: ' 
          + req.body.phone + ' | Error: ' + err);
        sendSMS(mobile, config.error_start_again);
      }
      else {
        // Updates user profile with first name and sends the next message. 
        mobilecommons.profile_update(mobile, config.ask_email
          , { SS_user_first_name: userSubmittedName })
      }
    }
  )
  response.send();
};

/**
 * Retrieves an email from the user to submit with the donation transaction. For
 * a Donors Choose donation, this is optional.
 *
 * @param request
 *   Express Request object
 * @param response
 *   Express Response object
 */
DonorsChooseDonationController.prototype.retrieveEmail = function(request, response) {
  var userSubmittedEmail = smsHelper.getFirstWord(request.body.args);
  var mobile = smsHelper.getNormalizedPhone(request.body.phone);
  logger.log('debug', 'DonorsChoose.retrieveEmail:%s for user:%s', userSubmittedEmail, mobile);

  var updateObject = { $set: { donation_complete: true }};
  var self = this;
  var req = request; 
  var config = app.getConfig(app.ConfigName.DONORSCHOOSE, donationConfigId);

  if (stringValidator.isValidEmail(userSubmittedEmail) && !stringValidator.containsNaughtyWords(userSubmittedEmail)) {
    updateObject['$set'].email = userSubmittedEmail;
  }
  
  donationModel.findOneAndUpdate(
    {
      $and : [
        { mobile: mobile },
        { donation_complete: false }
      ]
    },
    updateObject,
    function(err, donorDocument) {
      if (err) {
        logger.error('DonorsChoose.retrieveEmail error for user:' + mobile + ' in donationModel.findOneAndUpdate: ' + err);
        sendSMS(mobile, config.error_start_again);
      } 
      else if (donorDocument) {
        logger.log('debug', 'DonorsChoose.retrieveEmail donorDocument:%s: for user:%s', JSON.stringify(donorDocument), mobile);
        // In the case that the user is out of order in the donation flow, 
        // or our app hasn't found a proposal (aka project) and attached a 
        // project_id to the document, we opt the user back into the start donation flow.  
        if (!donorDocument.project_id) {
          sendSMS(mobile, config.error_start_again);
        }
        else {
          var donorInfoObject = {
            donorEmail: donorDocument.email, 
            donorFirstName: (donorDocument.first_name || 'Anonymous'),
            donorPhoneNumber: mobile
          }
          self.submitDonation(donorInfoObject, donorDocument.project_id, config);
        }
      }
      else {
        logger.log('error', 'DonorsChoose.retrieveEmail donorDocument not set.');
      }
    }
  )
  response.send();
};

/**
 * Submits a donation transaction to Donors Choose.
 *
 * @see https://data.donorschoose.org/docs/transactions/
 *
 * @param donorInfoObject = {donorEmail: string, donorFirstName: string}
 * @param proposalId, the DonorsChoose proposal ID 
 * @param donationConfig, the donorschoose config document 
 *
 */
DonorsChooseDonationController.prototype.submitDonation = function(donorInfoObject, proposalId, donationConfig) {

  var donorPhone = donorInfoObject.donorPhoneNumber;
  logger.log('debug', 'DonorsChoose.submitDonation user:%s info:%s proposal:%s config:%s', donorPhone, JSON.stringify(donorInfoObject), proposalId, JSON.stringify(donationConfig));

  requestToken().then(requestDonation,
    promiseErrorCallback('Unable to successfully retrieve donation token from DonorsChoose.org API. User mobile: '
      + donorPhone)
  );

  /**
   * First request: obtains a unique token for the donation.
   */
  function requestToken() {
    // Creates promise-storing object.
    var deferred = Q.defer();
    var retrieveTokenParams = { 'form': {
      'APIKey': donorsChooseApiKey,
      'apipassword': donorsChooseApiPassword, 
      'action': 'token'
    }}
    logger.log('debug', 'DonorsChoose.requestToken POST:%s', DONATE_API_URL);
    requestHttp.post(DONATE_API_URL, retrieveTokenParams, function(err, response, body) {
      logger.log('verbose', 'requestToken response:%s body:%s', JSON.stringify(response).trim(), JSON.stringify(body).trim());
      if (!err) {
        try {
          var jsonBody = JSON.parse(body);
          if (jsonBody.statusDescription == 'success') {
            logger.log('debug', 'DonorsChoose.retrieveToken success body:%s' + JSON.stringify(jsonBody).trim());
            deferred.resolve(JSON.parse(body).token);
          }
          else {
            logger.error('DonorsChoose.retrieveToken error to retrieve a donation token from the DonorsChoose API for user:' 
              + donorPhone);
            sendSMS(donorPhone, donationConfig.error_start_again);
          }
        }
        catch (e) {
          logger.error('DonorsChoose.retrieveToken error: failed trying to parse the donation token request response from DonorsChoose.org for user:' 
            + donorPhone + ' Error: ' + e.message + '| Response: ' + response + '| Body: ' + body);
          sendSMS(donorPhone, donationConfig.error_start_again);
        }
      }
      else {
        deferred.reject('DonorsChoose.retrieveToken error: unable to retrieve a response from the submit donation endpoint of DonorsChoose.org, user: ' 
          + donorPhone + 'error: ' + err);
        sendSMS(donorPhone, donationConfig.error_start_again);
      }
    });
    return deferred.promise;
  }

  /**
   * After promise we make the second request: donation transaction.
   */
  function requestDonation(tokenData) {
    var donateParams = {'form': {
      'APIKey': donorsChooseApiKey,
      'apipassword': donorsChooseApiPassword, 
      'action': 'donate',
      'token': tokenData,
      'proposalId': proposalId,
      'amount': DONATION_AMOUNT,
      'email': defaultDonorsChooseTransactionEmail,
      'honoreeEmail': donorInfoObject.donorEmail,
      'honoreeFirst': donorInfoObject.donorFirstName,
    }};

    logger.log('debug', 'DonorsChoose.requestDonation POST:%s params:%s', DONATE_API_URL, JSON.stringify(donateParams));
    requestHttp.post(DONATE_API_URL, donateParams, function(err, response, body) {
      logger.log('verbose', 'DonorsChoose.requestDonation body:', body.trim())
      if (err) {
        logger.error('DonorsChoose.requestDonation requestHttp error for user:' + donorInfoObject.donorPhoneNumber + 'error: ' + err);
        sendSMS(donorPhone, donationConfig.error_start_again);
      }
      else if (response && response.statusCode != 200) {
        logger.error('DonorsChoose.requestDonation statusCode:%s for user:%s | Response: ' + response, response.statusCode, donorInfoObject.donorPhoneNumber);
        sendSMS(donorPhone, donationConfig.error_start_again);
      }
      else {
        try {
          var jsonBody = JSON.parse(body);
          if (jsonBody.statusDescription == 'success') {
            logger.info('DonorsChoose.requestDonation success for user:' + donorPhone + ' proposal:' + proposalId + ' body:', jsonBody);
            updateUserWithDonation();
            sendSuccessMessages(donorPhone, donationConfig, jsonBody.proposalURL);
          }
          else {
            logger.warn('DonorsChoose.requestDonation status!=success user:' + donorPhone + ' proposal:' + proposalId + ' body:', jsonBody);
            sendSMS(donorPhone, donationConfig.error_start_again);
          }
        }
        catch (e) {
          logger.error('DonorsChoose.requestDonation catch exception for user:%s e:%s', donorPhone, e.message);
          sendSMS(donorPhone, donationConfig.error_start_again);
        }
      }
    })
  }

  /**
   * Start donation process.
   */
  function updateUserWithDonation() {
    logger.log('debug', 'donorsChoose.updateUserWithDonation user:%s', donorPhone);
    userModel.findOne({phone: donorPhone}, function(err, doc) {
      if (err) {
        logger.error('debug', 'DonorsChoose.updateUserWithDonation error:', err);
        return;
      }

      if (!doc) {
        logger.log('debug', 'donorsChoose.updateUserWithDonation userModel.create for user:%s', donorPhone);
        userModel.create({phone: donorPhone})
          .then(incrementDonationCount);
      }
      else {
        logger.log('debug', 'donorsChoose.updateUserWithDonation userModel doc exists for user:%s', donorPhone);
        incrementDonationCount(doc);
      }
    });
  }

  /**
   * Updates the donation count in a user's donation history.
   *
   * @param doc
   *   Document for user that made a donation
   */
  function incrementDonationCount(doc) {
    var i;
    var countUpdated = false;

    if (!doc) {
      logger.log('debug', 'donorsChoose.incrementDonationCount !doc');
      return;
    }
    logger.log('debug', 'donorsChoose.incrementDonationCount doc:%s', JSON.stringify(doc));
    logger.log('debug', 'donorsChoose.incrementDonationCount donationConfig:%s', JSON.stringify(donationConfig));

    // Find previous donation history and increment the count if found
    for (i = 0; i < doc.donations.length; i++) {
      logger.log('verbose', 'donorsChoose.incrementDonationCount i=', i);
      if (doc.donations[i].config_id == donationConfigId) {
        logger.log('verbose', 'donorsChoose.incrementDonationCount oc.donations[i].config_id == donationConfigId');
        doc.donations[i].count += 1;
        countUpdated = true;
        break;
      }
    }

    // If no previous donation found, add a new item
    if (!countUpdated) {
      logger.log('verbose', 'donorsChoose.incrementDonationCount !countUpdated');
      doc.donations[doc.donations.length] = {
        config_id: donationConfig._id,
        count: 1
      }
    }

    // Update the user document
    userModel.update(
      {phone: doc.phone},
      {$set: {donations: doc.donations}}
    ).exec();
    logger.log('debug', 'DonorsChoose.incrementDonationCount complete for user:%s donations:%s', doc.phone, JSON.stringify(doc.donations));
  }

  /**
   * Sends multiple messages to user after a successful donation.
   *
   * @param url
   *   URL to the DonorsChoose project
   */
  function sendSuccessMessages(mobileNumber, donationConfig, projectUrl) {
    logger.log('debug', 'DonorsChoose.sendSuccessMessages user:%s config:%s projectUrl%s', mobileNumber, JSON.stringify(donationConfig), projectUrl);

    // First message user receives. 
    mobilecommons.profile_update(mobileNumber, donationConfig.donation_complete_project_info_A);

    // Second message user receives. 
    setTimeout(function() {
      logger.log('verbose', 'DonorsChoose.sendSuccessMessages timeout 1');
      mobilecommons.profile_update(mobileNumber, donationConfig.donation_complete_project_info_B);
    }, END_MESSAGE_DELAY)

    // Last message user receives. Uses Bitly to shorten the link, then updates the user's MC profile.
    setTimeout(function() {
      shortenLink(projectUrl, function(shortenedLink) {
        logger.log('verbose', 'DonorsChoose.sendSuccessMessages timeout 2');
        var customFields = {
          SS_donation_url: shortenedLink
        };
        mobilecommons.profile_update(donorPhone, donationConfig.donation_complete_give_url, customFields);
      });
    }, END_MESSAGE_DELAY + END_MESSAGE_DELAY)
  }
};

/**
 * Retrieves the location of a user to use for finding a project. For Donors Choose
 * this will be the user's state.
 *
 * @param request
 *   Express Request object
 * @param response
 *   Express Response object
 */
DonorsChooseDonationController.prototype.retrieveLocation = function(request, response) {

  if (typeof request.body.phone === 'undefined' || typeof request.body.args === 'undefined') {
    response.status(406).send('Missing required params.');
    return;
  }

  response.send();

  var config = app.getConfig(app.ConfigName.DONORSCHOOSE, donationConfigId);
  var location = smsHelper.getFirstWord(request.body.args);

  if (TYPE_OF_LOCATION_WE_ARE_QUERYING_FOR == 'zip') {
    if (!stringValidator.isValidZip(location)) {
      sendSMS(request.body.phone, config.invalid_zip_oip);
      logger.info('User ' + request.body.phone 
        + ' did not submit a valid zipcode in the DonorsChoose.org flow.');
      return;
    }
  }
  else if (TYPE_OF_LOCATION_WE_ARE_QUERYING_FOR == 'state') {
    if (!stringValidator.isValidState(location)) {
      sendSMS(request.body.phone, config.invalid_state_oip);
      logger.info('User ' + request.body.phone 
        + ' did not submit a valid state abbreviation in the DonorsChoose.org flow.');
      return;
    }
  }

  var info = {
    mobile: request.body.phone,
    location: location
  };

  this._post('find-project?id=' + donationConfigId, info);
};

/**
 * Sets the hostname.
 *
 * @param host
 *   The hostname string.
 */
DonorsChooseDonationController.prototype.setHost = function(host) {
  this.host = host;
};

/**
 * POST data to another endpoint on this Donors Choose resource.
 *
 * @param endpoint
 *   Endpoint to POST to.
 * @param data
 *   Object with data to POST to the endpoint.
 */
DonorsChooseDonationController.prototype._post = function(endpoint, data) {
  var url = 'http://' + this.host + '/donations/' + this.resourceName + '/' + endpoint;

  var payload = {form:{}};
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    payload.form[keys[i]] = data[keys[i]];
  }

  requestHttp.post(url, payload, function(err, response, body) {
    if (err) {
      logger.error(err);
    }

    if (response && response.statusCode) {
      logger.info('DonorsChooseDonationController - POST to ' + url 
        + ' return status code: ' + response.statusCode);
    }
  });
}

/**
 * Sets the hostname.
 *
 * @param host
 *   The hostname string.
 */
DonorsChooseDonationController.prototype.setHost = function(host) {
  this.host = host;
};

/**
 * The following two functions are for handling Mongoose Promise chain errors.
 */
function promiseErrorCallback(message, userPhone) {
  return onPromiseErrorCallback.bind({message: message, userPhone: userPhone});
}

function onPromiseErrorCallback(err) {
  if (err) {
    logger.error(this.message + '\n', err.stack);
    sendSMS(this.userPhone, config.error_start_again)
  }
}

/**
 * Subscribe phone number to a Mobile Commons opt-in path.
 *
 * @param phone
 *  Phone number to subscribe.
 * @param oip
 *   Opt-in path to subscribe to.
 */
function sendSMS(phone, oip) {
  mobilecommons.profile_update(phone, oip);
};

module.exports = DonorsChooseDonationController;
