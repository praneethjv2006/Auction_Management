const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const participantController = require('../controllers/participantController');
const itemController = require('../controllers/itemController');
const bidController = require('../controllers/bidController');

router.get('/', roomController.getRooms);
router.post('/', roomController.createRoom);
router.get('/:roomId', roomController.getRoom);
router.post('/:roomId/participants', participantController.addParticipant);
router.post('/:roomId/items', itemController.addItem);
router.post('/:roomId/start', roomController.startAuction);
router.post('/:roomId/select-item', roomController.selectItem);
router.post('/:roomId/stop-item', roomController.stopCurrentItem);
router.post('/:roomId/auto', roomController.configureAutoAuction);
router.post('/:roomId/end', roomController.endAuction);
router.post('/:roomId/next', roomController.nextItem);
router.post('/:roomId/skip', roomController.skipItem);
router.post('/:roomId/bids', bidController.placeBid);

module.exports = router;
