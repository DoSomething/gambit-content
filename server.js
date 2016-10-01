require('newrelic'); // eslint-disable-line strict
// @see https://docs.newrelic.com/docs/agents/nodejs-agent/installation-configuration
// New Relic is required on first line, otherwise would declare 'use strict' for line 1 per eslint

// Wrapper around require to set relative path at app root
global.rootRequire = function (name) {
  return require(`${__dirname}/${name}`);
};

const express = require('express');
const http = require('http');
const logger = rootRequire('lib/logger');
const phoenix = rootRequire('lib/phoenix')();

// Default is 5. Increasing # of concurrent sockets per host.
http.globalAgent.maxSockets = 100;

const username = process.env.DS_PHOENIX_API_USERNAME;
const password = process.env.DS_PHOENIX_API_PASSWORD;
phoenix.userLogin(username, password, (err, response) => {
  if (err) {
    logger.error(err);
  }
  if (response && response.statusCode === 200) {
    logger.info('Successfully logged in to %s Phoenix API.', process.env.NODE_ENV);
  }
});


app = express();

require('./config')();

require('./config/smsConfigsLoader');

require('./config/router');

app.loadLocals().then(() => {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    logger.info(`Gambit is listening, port:${port} env:${process.env.NODE_ENV}.`);
  });
});
