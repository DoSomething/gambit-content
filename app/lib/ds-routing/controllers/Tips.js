/**
 * Tips API
 */

var mongoose = require('mongoose')
  , mobilecommons = rootRequire('mobilecommons')
  , logger = rootRequire('app/lib/logger')
  , connectionOperations = rootRequire('app/config/connectionOperations')
  , tipModel = require('../models/tip')(connectionOperations);
  ;

var Tips = function() {}

/**
 * Progress a user through a series of tips delivered via Mobile Commons opt-in paths.
 *
 * @param request
 *   The request object.
 * @param response
 *   The response object.
 * @param mdataOverride
 *   Optional. mData ID which is typically pulled from the request.body can be
 *   overriden by this parameter instead.
 */
Tips.prototype.deliverTips = function(request, response, mdataOverride) {
  if (typeof(request.body.mdata_id) === 'undefined' && typeof(mdataOverride) === 'undefined') {
    app.stathatReport('Count', 'mobilecommons: tips request: error - missing mData ID', 1);

    response.sendStatus(204);
    return;
  }

  // Use mdataOverride if provided. Otherwise, use what's in the request body.
  var mdataId = parseInt(request.body.mdata_id);
  if (typeof(mdataOverride) === 'number') {
    mdataId = mdataOverride;
  }

  // Decide tip name based on the mdata id.
  var tipConfig = app.getConfig('tips_config', mdataId);

  // Config error checking
  if (typeof(tipConfig) === 'undefined'
      || typeof(tipConfig.name) === 'undefined'
      || typeof(tipConfig.optins) === 'undefined') {
    app.stathatReport('Count', 'mobilecommons: tips request: error - config not set', 1);
    response.sendStatus(501);
    return;
  }

  // Find an existing document for a user with the requesting phone number
  tipModel.findOne(
    {phone: request.body.phone},
    function(err, doc) {

      if (err) {
        return logger.error(err);
      }

      // An existing doc for this phone number has been found
      if (doc) {

        var lastTip = -1;
        var ltdIndex = -1;

        // Check to see what tip the user received last
        for (var i = 0; i < doc.last_tip_delivered.length; i++) {
          if (doc.last_tip_delivered[i].name === tipConfig.name) {
            lastTip = doc.last_tip_delivered[i].last_tip;
            ltdIndex = i;
          }
        }

        // Get index of the last tip delivered
        var tipIndex = -1;
        if (lastTip > 0) {
          tipIndex = tipConfig.optins.indexOf(lastTip);
        }

        // Select next tip
        tipIndex++;

        // If next selected tip is past the end, loop back to the first one
        if (tipIndex >= tipConfig.optins.length) {
          tipIndex = 0;
        }

        // Get the opt-in path for the next tip
        var optin = tipConfig.optins[tipIndex];

        // Update last_tip with the selected opt-in path
        if (ltdIndex >= 0) {
          doc.last_tip_delivered[ltdIndex].last_tip = optin;
        }
        else {
          doc.last_tip_delivered[doc.last_tip_delivered.length] = {
            'name': tipConfig.name,
            'last_tip': optin
          };
        }

        // Send the opt-in request to Mobile Commons
        var args = {
          alphaPhone: request.body.phone,
          alphaOptin: optin
        };

        if (request.body.dev !== '1') {
          mobilecommons.optin(args);

          app.stathatReport('Count', 'mobilecommons: tips request: success', 1);
        }

        // Update the existing doc in the database
        var data = {
          'phone': request.body.phone,
          'last_tip_delivered': doc.last_tip_delivered
        };

        tipModel.update(
          {phone: request.body.phone},
          data,
          function(err, num, raw) {
            if (err) {
              return logger.error(err);
            }

            logger.log('debug', 'Updated %d document(s).', num);
            logger.info('Tip model updated:', doc._id.toString(), 'with optin:', optin);
          }
        );
      }
      // An existing doc for this phone was not found
      else {
        // Select the first opt in path in the array
        var optin = tipConfig.optins[0];
        var args = {
          alphaPhone: request.body.phone,
          alphaOptin: optin
        };

        if (request.body.dev !== '1') {
          mobilecommons.optin(args);
          app.stathatReport('Count', 'mobilecommons: tips request: success', 1);
        }

        // Create a new doc
        var model = new tipModel({
          'phone': request.body.phone,
          'last_tip_delivered': [{
            'name': tipConfig.name,
            'last_tip': optin
          }]
        });

        // Save the doc to the database
        model.save(function(err, doc, num) {
          if (err) {
            return logger.error(err);
          }

          if (doc && doc._id) {
            logger.info('Tip model saved:', doc._id.toString());
          }
        });

        logger.log('debug', 'Saving new model:', model);
      }
    }
  );

  response.send();
}

module.exports = Tips;
