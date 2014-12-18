var assert = require('assert')
  , express = require('express')
  , emitter = rootRequire('app/eventEmitter')
  , connectionOperations = rootRequire('app/config/connectionOperations')
  , gameMappingModel = rootRequire('app/lib/sms-games/models/sgGameMapping')(connectionOperations)
  , gameModel = rootRequire('app/lib/sms-games/models/sgCompetitiveStory')(connectionOperations)
  , userModel = rootRequire('app/lib/sms-games/models/sgUser')(connectionOperations)
  , SGCompetitiveStoryController = rootRequire('app/lib/sms-games/controllers/SGCompetitiveStoryController')
  , gameConfig = rootRequire('app/lib/sms-games/config/competitive-stories')
  , smsHelper = rootRequire('app/lib/smsHelpers')
  , testHelper = require('./testHelperFunctions')
  ;

describe('Alpha-Starting a Bully Text game:', function() {
  // Test players' details.
  var alphaName = 'alpha';
  var alphaPhone = '5555550100';
  var betaName0 = 'friend0';
  var betaName1 = 'friend1';
  var betaName2 = 'friend2';
  var betaPhone0 = '5555550101';
  var betaPhone1 = '5555550102';
  var betaPhone2 = '5555550103';
  var storyId = 100;

  testHelper.gameAppSetup();

  describe('Creating a Competitive Story game based on the test config file', function() {
    var request;
    before(function() {
      // Test request object to create the game.
      request = {
        body: {
          story_id: storyId,
          alpha_first_name: alphaName,
          alpha_mobile: alphaPhone,
          beta_mobile_0: betaPhone0,
          beta_mobile_1: betaPhone1,
          beta_mobile_2: betaPhone2
        }
      };
    });

    it('should emit all game doc events', function(done) {
      var eventCount = 0;
      var expectedEvents = 6;

      var onEventReceived = function() {
        eventCount++;
        if (eventCount == expectedEvents) {
          done();

          emitter.removeAllListeners('alpha-user-created');
          emitter.removeAllListeners('beta-user-created');
          emitter.removeAllListeners('game-mapping-created');
          emitter.removeAllListeners('game-created');
        }
      };

      // 1 expected alpha-user-created event
      emitter.on('alpha-user-created', onEventReceived);
      // 3 expected beta-user-created events
      emitter.on('beta-user-created', onEventReceived);
      // 1 expected game-mapping-created event. (Callback function takes a 'doc' 
      // argument because the emitter.emit() function gets passed a Mongo doc.)
      emitter.on('game-mapping-created', function(doc) {
        gameMappingId = doc._id;
        onEventReceived();
      });
      // 1 expected game-created event
      emitter.on('game-created', function(doc) {
        gameId = doc._id;
        onEventReceived();
      });

      // With event listeners setup, can now create the game.
      assert.equal(true, this.gameController.createGame(request, response));
    });

    it('should add sg_user doc for alpha user', function(done) {
      var phone = smsHelper.getNormalizedPhone(alphaPhone);
      userModel.find({phone: phone}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })

    it('should add sg_user doc for beta0 user', function(done) {
      var phone = smsHelper.getNormalizedPhone(betaPhone0);
      userModel.find({phone: phone}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })

    it('should add sg_user doc for beta1 user', function(done) {
      var phone = smsHelper.getNormalizedPhone(betaPhone1);
      userModel.find({phone: phone}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })

    it('should add sg_user doc for beta2 user', function(done) {
      var phone = smsHelper.getNormalizedPhone(betaPhone2);
      userModel.find({phone: phone}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })

    it('should add a sg_gamemapping document', function(done) {
      gameMappingModel.find({_id: gameMappingId}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })

    it('should add a sg_competitivestory_game document', function(done) {
      gameModel.find({_id: gameId}, function(err, docs) {
        if (!err && docs.length > 0) { done(); }
        else { assert(false); }
      })
    })
  })

  describe('Beta 1 joining the game', function() {
    testHelper.betaJoinGameTest(betaPhone1);
  })

  describe('Alpha starting the game', function() {
    var request;
    before(function() {
      phone = smsHelper.getNormalizedPhone(alphaPhone);
      request = {
        body: {
          phone: phone,
          args: 'Y'
        }
      }
    })

    it('should emit game-updated event', function(done) {
      emitter.on('game-updated', function() {
        done();
        emitter.removeAllListeners('game-updated');
      });

      // Alpha force starts the game.
      this.gameController.alphaStartGame(request, response);
    })

    it('should start the game', function(done) {
      var alphaStarted = beta1Started = false;
      var startOip = gameConfig[storyId].story_start_oip;
      gameModel.findOne({_id: gameId}, function(err, doc) {
        if (!err && doc) {
          for (var i = 0; i < doc.players_current_status.length; i++) {
            var phone = doc.players_current_status[i].phone;
            var currPath = doc.players_current_status[i].opt_in_path;

            var aPhone = smsHelper.getNormalizedPhone(alphaPhone);
            var b0Phone = smsHelper.getNormalizedPhone(betaPhone0);
            var b1Phone = smsHelper.getNormalizedPhone(betaPhone1);
            var b2Phone = smsHelper.getNormalizedPhone(betaPhone2);

            if (phone == b0Phone || phone == b2Phone) {
              assert(false, 'Beta users sent message when they shouldn\'t have received any.');
            }
            else if (currPath == startOip) {
              if (phone == aPhone)
                alphaStarted = true;
              else if (phone == b1Phone)
                beta1Started = true;
            }
          }
        }

        assert(alphaStarted && beta1Started);
        done();
      })
    })
  })

  after(function() {
    // Remove all test documents
    userModel.remove({phone: smsHelper.getNormalizedPhone(alphaPhone)}, function() {});
    userModel.remove({phone: smsHelper.getNormalizedPhone(betaPhone0)}, function() {});
    userModel.remove({phone: smsHelper.getNormalizedPhone(betaPhone1)}, function() {});
    userModel.remove({phone: smsHelper.getNormalizedPhone(betaPhone2)}, function() {});
    gameMappingModel.remove({_id: gameMappingId}, function() {});
    gameModel.remove({_id: gameId}, function() {});
    this.gameController = null;
  })
})
