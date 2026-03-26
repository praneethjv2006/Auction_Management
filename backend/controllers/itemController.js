const prisma = require('../lib/prisma');
const { emitRoomUpdate } = require('./roomController');
const { AuctionFactory } = require('../models/factory');

exports.addItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { name, price, category } = req.body;
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
  const normalizedCategory = String(category || 'General').trim() || 'General';

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      categories: { orderBy: { name: 'asc' } },
    },
  });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.categories.length > 0) {
    const allowedCategory = room.categories.find(
      (entry) => entry.name.toLowerCase() === normalizedCategory.toLowerCase()
    );

    if (!allowedCategory) {
      return res.status(400).json({
        error: 'Category must be selected from room categories configured by organizer',
      });
    }
  }

  const itemData = AuctionFactory.createItem({
    name,
    price: parsedPrice,
    firstBid: parsedPrice,
    currentBid: parsedPrice,
    status: 'upcoming',
    category: normalizedCategory,
    auctionRoomId: roomId,
  });

  const item = await prisma.item.create({ data: itemData });
  await emitRoomUpdate(roomId);
  return res.status(201).json(item);
};
