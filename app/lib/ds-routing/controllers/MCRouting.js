/**
 * Custom DS routing for transition logic within and between Mobile Commons campaigns.
 */

var mobilecommons = rootRequire('mobilecommons');
var logger = rootRequire('app/lib/logger');

var MCRouting = function() {}

/**
 * Opt user into one of two paths depending on whether the response is yes or no.
 */
MCRouting.prototype.yesNoGateway = function(request, response) {
  logger.log('verbose', 'MCRouting.yesNoGateway request.body:', JSON.stringify(request.body));
  if (request.body.args === undefined || request.body.opt_in_path_id === undefined) {
    logger.log('warn', 'MCRouting.yesNoGateway 204: missing args or opt_in_path_id:%s', JSON.stringify(request.body));
    response.sendStatus(204);
    return;
  }
  var phone = request.body.phone;
  var incomingOptIn = parseInt(request.body.opt_in_path_id);
  logger.log('debug', 'MCRouting.yesNoGateway request from user:%s from oip:%d', phone, incomingOptIn);
  var path = app.getConfig(app.ConfigName.YES_NO_PATHS, incomingOptIn);

  if (path === undefined) {
    logger.log('warn', "MCRouting.yesNoGateway 204: config doc not found for oip:%d user:%s", incomingOptIn, phone);
    response.sendStatus(204);
    return;
  }
  
  var args = request.body.args.trim().toLowerCase();
  // Just check based on the first word in the message.
  args = args.split(' ');
  var firstWord = args[0];
  logger.log('debug', 'MCRouting.yesNoGateway user:%s sent:%s', phone, request.body.args);

  // Default to the 'no' response. Change to 'yes' response if appropriate answer found.
  var optinPath = path.no;
  var optinDesc = 'NO';
  var yesAnswers = ['y', 'yes', 'ya', 'yea'];
  for (var i = 0; i < yesAnswers.length; i++) {
    if (yesAnswers[i] === firstWord) {
      optinDesc = 'YES';
      optinPath = path.yes;
      break;
    }
  }
  logger.log('debug', 'MCRouting.yesNoGateway user:%s firstWord:%s to %s oip:%d', phone, firstWord, optinDesc, optinPath);

  // Execute the opt-in.
  var args = {
    alphaPhone: request.body.phone,
    alphaOptin: optinPath
  };
  mobilecommons.optin(args);
  response.send();
};

/**
 * Transitions user from a MoCo Signup-campaign into corresponding MoCo Campaign-campaign.
 */
MCRouting.prototype.campaignTransition = function(request, response) {
  logger.log('verbose', 'MCRouting.campaignTransition request.body:%s', JSON.stringify(request.body));
  if (typeof(request.body.mdata_id) === 'undefined') {
    logger.log('info', "MCRouting.campaignTransition request.body.mdata_id is undefined:%s", JSON.stringify(request.body));
    response.sendStatus(204);
    return;
  }

  var mdataId = parseInt(request.body.mdata_id);
  logger.log('debug', 'MCRouting.campaignTransition mdataId:%d', mdataId); 
  var transitionConfig = app.getConfig(app.ConfigName.CAMPAIGN_TRANSITIONS, mdataId);

  if (typeof(transitionConfig) !== 'undefined'
      && typeof(transitionConfig.optin) !== 'undefined'
      && typeof(transitionConfig.optout) !== 'undefined') {
    // Opt in the user to the campaign start.
    var optinArgs = {
      alphaPhone: request.body.phone,
      alphaOptin: transitionConfig.optin
    };
    mobilecommons.optin(optinArgs);

    // Opt out the user from the "sign up" campaign.
    var optoutArgs = {
      phone: request.body.phone,
      campaignId: transitionConfig.optout
    };
    mobilecommons.optout(optoutArgs);

    response.send();
  }
  else {
    logger.log('warn', "MCRouting.campaignTransition transitionConfig document error for mdataId:" + mdataId);
    // Config for that mData is not set.
    response.sendStatus(501);
  }
};

module.exports = MCRouting;