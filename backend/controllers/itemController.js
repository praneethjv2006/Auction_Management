const prisma = require('../lib/prisma');
const { emitRoomUpdate } = require('./roomController');

exports.addItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { name, price } = req.body;
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Item name is required' });
  }
  const parsedPrice = Number(price);
  if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Valid price is required' });
  }
  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const item = await prisma.item.create({
    data: {
      name: name.trim(),
      price: parsedPrice,
      firstBid: parsedPrice,
      currentBid: parsedPrice,
      status: 'upcoming',
      auctionRoomId: roomId,
    },
  });
  await emitRoomUpdate(roomId);
  return res.status(201).json(item);
};
