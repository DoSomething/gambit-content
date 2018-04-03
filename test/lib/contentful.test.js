'use strict';

// libs
require('dotenv').config();
const Promise = require('bluebird');
const test = require('ava');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const logger = require('winston');
const rewire = require('rewire');
const underscore = require('underscore');

// app modules
const stubs = require('../../test/utils/stubs');
const stathat = require('../../lib/stathat');
const contentfulAPI = require('contentful');

// setup "x.should.y" assertion style
chai.should();
chai.use(sinonChai);

// module to be tested
const contentful = rewire('../../lib/contentful');

// sinon sandbox object
const sandbox = sinon.sandbox.create();

// Stubs
const allKeywordsStub = Promise.resolve(stubs.contentful.getEntries('keywords'));
const keywordStub = Promise.resolve(stubs.contentful.getEntries('keyword'));
const failStub = Promise.reject({ status: 500 });
const contentfulAPIStub = {
  getEntries: () => {},
};

// Setup!
test.beforeEach(() => {
  stubs.stubLogger(sandbox, logger);
  sandbox.stub(stathat, 'postStat');
  sandbox.stub(contentfulAPI, 'createClient')
    .returns(contentfulAPIStub);
});

// Cleanup!
test.afterEach((t) => {
  // reset stubs, spies, and mocks
  sandbox.restore();
  t.context = {};

  // reset client state on each test
  contentful.__set__('client', undefined);
});

// createNewClient
test('createNewClient should create a new contentful client', () => {
  contentful.createNewClient();
  contentfulAPI.createClient.should.have.been.called;
  contentful.getClient().should.respondTo('getEntries');
});

// getClient
test('getClient should return the existing contentful client if already created', () => {
  // setup
  const newClient = contentful.getClient();
  const sameClient = contentful.getClient();

  // test
  contentfulAPI.createClient.should.have.been.calledOnce;
  newClient.should.be.equal(sameClient);
});

// contentfulError
test('contentfulError should add the Contentful error prefix to the error object passed', () => {
  const prefix = contentful.__get__('ERROR_PREFIX');
  const errorObj = { message: 'tacos' };
  const error = contentful.contentfulError(errorObj);
  error.message.should.have.string(prefix);
});

// fetchSingleEntry
test('fetchSingleEntry should only get one item from the entries returned by contentful', async () => {
  // setup
  sandbox.spy(underscore, 'first');

  // fetchSingleEntry calls getEntries so we stub it here using rewire's __set__
  contentful.__set__('client', {
    getEntries: sinon.stub().returns(allKeywordsStub),
  });

  // test
  const entry = await contentful.fetchSingleEntry();
  underscore.first.should.have.been.called;
  entry.should.be.an('object');
  entry.should.not.be.an('array');
});

test('fetchSingleEntry should reject with a contentfulError if unsuccessful', async () => {
  // setup
  sandbox.spy(contentful, 'contentfulError');
  contentful.__set__('client', {
    getEntries: sinon.stub().returns(failStub),
  });

  // test
  try {
    await contentful.fetchSingleEntry();
  } catch (error) {
    error.status.should.be.equal(500);
  }
  contentful.contentfulError.should.have.been.called;
});

// fetchKeyword
test('fetchKeyword should send contentful a query with content_type of keyword', async () => {
  // setup
  sandbox.stub(contentful, 'fetchSingleEntry').returns(keywordStub);
  const keyword = stubs.getKeyword();
  const query = contentful.getQueryBuilder().contentType('keyword').keyword(keyword).build();

  // test
  await contentful.fetchKeyword(keyword);
  contentful.fetchSingleEntry.getCall(0).args[0].should.be.eql(query);
});

// fetchKeywords
test('fetchKeywords should send contentful a query with content_type of keyword and current env', async () => {
  // setup
  contentful.__set__('client', {
    getEntries: sinon.stub().returns(allKeywordsStub),
  });
  const env = stubs.getEnvironment();
  const query = contentful.getQueryBuilder().contentType('keyword').environment(env).build();

  // test
  await contentful.fetchKeywords();
  contentful.getClient().getEntries.getCall(0).args[0].should.be.eql(query);
});

test('fetchKeywords should call contentfulError when it fails', async () => {
  // setup
  sandbox.spy(contentful, 'contentfulError');
  contentful.__set__('client', {
    getEntries: sinon.stub().returns(failStub),
  });

  // test
  await contentful.fetchKeywords();
  contentful.contentfulError.should.have.been.called;
});
