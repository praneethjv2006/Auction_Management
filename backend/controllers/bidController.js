const prisma = require('../lib/prisma');
const { getRoomSnapshot, emitRoomUpdate } = require('./roomController');

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

  if (item.currentBid != null && parsedAmount <= item.currentBid) {
    return res.status(400).json({ error: 'Bid must be higher than current bid' });
  }

  if (parsedAmount > participant.remainingPurse) {
    return res.status(400).json({ error: 'Bid exceeds remaining purse' });
  }

  await prisma.$transaction([
    prisma.bid.create({
      data: {
        amount: parsedAmount,
        participantId: participant.id,
        itemId: item.id,
      },
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        currentBid: parsedAmount,
        winnerId: participant.id,
      },
    }),
  ]);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(updatedRoom);
};
