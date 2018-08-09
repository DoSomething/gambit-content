'use strict';

require('dotenv').config();

const test = require('ava');
const chai = require('chai');
const sinonChai = require('sinon-chai');
const sinon = require('sinon');

const contentful = require('../../../lib/contentful');
const stubs = require('../../utils/stubs');
const askYesNoEntryFactory = require('../../utils/factories/contentful/askYesNo');
const autoReplyFactory = require('../../utils/factories/contentful/autoReply');
const autoReplyBroadcastFactory = require('../../utils/factories/contentful/autoReplyBroadcast');
const defaultTopicTriggerFactory = require('../../utils/factories/contentful/defaultTopicTrigger');
const messageFactory = require('../../utils/factories/contentful/message');

// stubs
const askYesNoEntry = askYesNoEntryFactory.getValidAskYesNo();
const autoReplyEntry = autoReplyFactory.getValidAutoReply();
const autoReplyBroadcastEntry = autoReplyBroadcastFactory.getValidAutoReplyBroadcast();
const defaultTopicTriggerEntry = defaultTopicTriggerFactory.getValidDefaultTopicTrigger();
const messageEntry = messageFactory.getValidMessage();

// Module to test
const contentfulEntryHelper = require('../../../lib/helpers/contentfulEntry');

chai.should();
chai.use(sinonChai);

const sandbox = sinon.sandbox.create();

test.afterEach(() => {
  sandbox.restore();
});


// getSummaryFromContentfulEntry
test('getSummaryFromContentfulEntry returns an object with name and type properties', () => {
  const stubEntryDate = Date.now();
  const stubEntry = askYesNoEntryFactory.getValidAskYesNo(stubEntryDate);
  const stubEntryId = stubs.getContentfulId();
  const stubContentType = stubs.getTopicContentType();
  const stubNameText = stubs.getBroadcastName();
  sandbox.stub(contentful, 'getContentTypeFromContentfulEntry')
    .returns(stubContentType);

  const result = contentfulEntryHelper.getSummaryFromContentfulEntry(stubEntry);
  result.id.should.equal(stubEntryId);
  result.type.should.equal(stubContentType);
  result.name.should.equal(stubNameText);
  result.createdAt.should.equal(stubEntryDate);
  result.updatedAt.should.equal(stubEntryDate);
});

// getTopicTemplatesFromContentfulEntry
test('getTopicTemplatesFromContentfulEntry returns an object with templates values if content type config has templates', () => {
  const result = contentfulEntryHelper.getTopicTemplatesFromContentfulEntry(autoReplyEntry);
  result.autoReply.text.should.equal(autoReplyEntry.fields.autoReply);
});

test('getTopicTemplatesFromContentfulEntry returns an empty object if content type config does not have templates', () => {
  const result = contentfulEntryHelper
    .getTopicTemplatesFromContentfulEntry(autoReplyBroadcastEntry);
  result.should.deep.equal({});
});

// isAutoReply
test('isAutoReply returns whether content type is autoReply', (t) => {
  t.falsy(contentfulEntryHelper.isAutoReply(askYesNoEntry));
  t.truthy(contentfulEntryHelper.isAutoReply(autoReplyEntry));
});

// isBroadcastable
test('isBroadcastable returns whether content type is broadcastable', (t) => {
  t.truthy(contentfulEntryHelper.isBroadcastable(askYesNoEntry));
  t.falsy(contentfulEntryHelper.isBroadcastable(messageEntry));
});

// isDefaultTopicTrigger
test('isDefaultTopicTrigger returns whether content type is defaultTopicTrigger', (t) => {
  t.truthy(contentfulEntryHelper.isDefaultTopicTrigger(defaultTopicTriggerEntry));
  t.falsy(contentfulEntryHelper.isDefaultTopicTrigger(messageEntry));
});

// isMessage
test('isMessage returns whether content type is message', (t) => {
  t.truthy(contentfulEntryHelper.isMessage(messageEntry));
  t.falsy(contentfulEntryHelper.isMessage(autoReplyEntry));
});