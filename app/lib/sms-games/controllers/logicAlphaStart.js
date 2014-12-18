var emitter = rootRequire('app/eventEmitter')
  , logger = rootRequire('app/lib/logger')
  , connectionOperations = rootRequire('app/config/connectionOperations')
  , gameModel = rootRequire('app/lib/sms-games/models/sgCompetitiveStory')(connectionOperations)
  , start = require('./logicGameStart')
  ;

/**
 * Callback after alpha's game is found. Handles an alpha choosing to start
 * the game before all players have joined.
 */
module.exports = function(request, doc) {
  // Start the game.
  doc = start.game(doc);

  // Save the doc in the database with the current status updates.
  gameModel.update(
    {_id: doc._id},
    {$set: {
      players_current_status: doc.players_current_status,
      game_started: doc.game_started
    }},
    function(err, num, raw) {
      if (err) {
        logger.error(err);
      }
      else {
        emitter.emit('game-updated');
        logger.info('Alpha is starting the game. Updating game doc:', doc._id.toString());
      }
    }
  );
};
