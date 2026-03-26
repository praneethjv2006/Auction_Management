const prisma = require('../lib/prisma');
const {
  getRoomSnapshot,
  emitRoomUpdate,
  hasParticipantSkippedCurrentItem,
} = require('./roomController');
const { AuctionFactory } = require('../models/factory');
const { processBidWithPatterns } = require('../models/bidFlow');

exports.placeBid = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { participantId, amount } = req.body;

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Valid bid amount is required' });
  }

  const participant = await prisma.participant.findUnique({
    where: { id: Number(participantId) },
  });

  if (!participant || participant.roomId !== roomId) {
    return res.status(404).json({ error: 'Participant not found in room' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      participants: { select: { id: true } },
    },
  });

  if (!room || !room.currentItemId) {
    return res.status(400).json({ error: 'No ongoing item to bid on' });
  }

  const item = await prisma.item.findUnique({
    where: { id: room.currentItemId },
  });

  if (!item || item.status !== 'ongoing') {
    return res.status(400).json({ error: 'Bidding is not open for this item' });
  }

  const participantSkipped = await hasParticipantSkippedCurrentItem(roomId, participant.id);
  if (participantSkipped) {
    return res.status(400).json({ error: 'You skipped this item and cannot bid anymore' });
  }

  if (item.currentBid != null && parsedAmount <= item.currentBid) {
    return res.status(400).json({ error: 'Bid must be higher than current bid' });
  }

  if (parsedAmount > participant.remainingPurse) {
    return res.status(400).json({ error: 'Bid exceeds remaining purse' });
  }

  const bidContext = processBidWithPatterns({
    roomId,
    item,
    participant,
    requestedAmount: parsedAmount,
    participantIds: room.participants.map((entry) => entry.id),
    strategyType: req.body.strategyType || 'manual',
    strategyOptions: req.body.strategyOptions,
  });

  await prisma.$transaction([
    prisma.bid.create({
      data: AuctionFactory.createBid({
        amount: bidContext.bidAmount,
        participantId: participant.id,
        itemId: item.id,
      }),
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        currentBid: bidContext.bidAmount,
        winnerId: bidContext.winnerId,
      },
    }),
  ]);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(updatedRoom);
};
