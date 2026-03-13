const prisma = require('../lib/prisma');
const { getIo } = require('../lib/socketStore');
const { ensureDefaultOrganizer } = require('./organizerController');

const autoConfigByRoom = new Map();
const autoTimerByRoom = new Map();
const autoDeadlineByRoom = new Map();
const boughtOrderByRoom = new Map();

function getAutoConfig(roomId) {
  return autoConfigByRoom.get(roomId) || { enabled: false, bidWindowSeconds: 0 };
}

function getAutoMeta(roomId) {
  const config = getAutoConfig(roomId);
  const deadline = autoDeadlineByRoom.get(roomId) || null;
  const timeLeftSeconds = deadline
    ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    : null;
  return {
    enabled: !!config.enabled,
    bidWindowSeconds: config.bidWindowSeconds || 0,
    timeLeftSeconds,
    deadlineTs: deadline,
  };
}

function getBoughtOrderState(roomId) {
  const roomMap = boughtOrderByRoom.get(roomId);
  if (!roomMap) return {};

  const result = {};
  for (const [participantId, itemIds] of roomMap.entries()) {
    result[String(participantId)] = itemIds;
  }
  return result;
}

function applyBoughtItemOrder(room) {
  if (!room) return room;
  const roomMap = boughtOrderByRoom.get(room.id);
  if (!roomMap) return room;

  const participants = room.participants.map((participant) => {
    const order = roomMap.get(participant.id);
    if (!order || !order.length) return participant;

    const byId = new Map((participant.winningItems || []).map((item) => [item.id, item]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const missing = (participant.winningItems || []).filter((item) => !order.includes(item.id));

    return {
      ...participant,
      winningItems: [...ordered, ...missing],
    };
  });

  return {
    ...room,
    participants,
  };
}

function withAutoMeta(room) {
  if (!room) return room;
  const roomWithOrder = applyBoughtItemOrder(room);
  return {
    ...roomWithOrder,
    autoAuction: getAutoMeta(room.id),
    boughtItemOrderByParticipant: getBoughtOrderState(room.id),
  };
}

function clearAutoTimer(roomId) {
  const existingTimer = autoTimerByRoom.get(roomId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  autoTimerByRoom.delete(roomId);
  autoDeadlineByRoom.delete(roomId);
}

async function setBoughtItemOrder(roomId, participantId, itemIds) {
  const room = await getRoomSnapshot(roomId);
  if (!room) {
    return { ok: false, status: 404, error: 'Room not found' };
  }

  const participant = room.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { ok: false, status: 404, error: 'Participant not found in room' };
  }

  const winningIds = (participant.winningItems || []).map((item) => item.id);
  const deduped = Array.from(new Set(itemIds));
  const sameLength = deduped.length === winningIds.length;
  const sameSet = winningIds.every((id) => deduped.includes(id));
  if (!sameLength || !sameSet) {
    return { ok: false, status: 400, error: 'Invalid item order payload' };
  }

  if (!boughtOrderByRoom.has(roomId)) {
    boughtOrderByRoom.set(roomId, new Map());
  }
  boughtOrderByRoom.get(roomId).set(participantId, deduped);

  await emitRoomUpdate(roomId);
  return { ok: true };
}

function pickRandomUpcomingItem(items) {
  const upcomingItems = items.filter((item) => item.status === 'upcoming');
  if (!upcomingItems.length) return null;
  const randomIndex = Math.floor(Math.random() * upcomingItems.length);
  return upcomingItems[randomIndex];
}

async function getRoomSnapshot(roomId) {
  return prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      organizer: true,
      currentItem: {
        include: {
          winner: true,
        },
      },
      participants: {
        orderBy: { id: 'asc' },
        include: {
          winningItems: true,
        },
      },
      items: { orderBy: { id: 'asc' } },
    },
  });
}

async function emitRoomUpdate(roomId) {
  const io = getIo();
  if (!io) return;
  const room = await getRoomSnapshot(roomId);
  if (room) {
    io.to(`room:${roomId}`).emit('room:update', withAutoMeta(room));
  }
}

async function startAutoTimer(roomId) {
  const config = getAutoConfig(roomId);
  if (!config.enabled || !config.bidWindowSeconds) {
    clearAutoTimer(roomId);
    return;
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room || room.status !== 'live' || !room.currentItemId) {
    clearAutoTimer(roomId);
    return;
  }

  clearAutoTimer(roomId);
  const timeoutMs = config.bidWindowSeconds * 1000;
  autoDeadlineByRoom.set(roomId, Date.now() + timeoutMs);

  const timer = setTimeout(async () => {
    await runAutoProgression(roomId);
  }, timeoutMs);

  autoTimerByRoom.set(roomId, timer);
  await emitRoomUpdate(roomId);
}

async function runAutoProgression(roomId) {
  clearAutoTimer(roomId);

  const config = getAutoConfig(roomId);
  if (!config.enabled) {
    await emitRoomUpdate(roomId);
    return;
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room || room.status !== 'live') {
    await emitRoomUpdate(roomId);
    return;
  }

  const updates = [];
  const finalizeUpdates = await finalizeCurrentItem(room);
  updates.push(...finalizeUpdates);

  const refreshedRoom = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!refreshedRoom) {
    await emitRoomUpdate(roomId);
    return;
  }

  const nextItem = pickRandomUpcomingItem(refreshedRoom.items);

  updates.push(
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: {
        currentItemId: nextItem ? nextItem.id : null,
        status: nextItem ? 'live' : 'ended',
      },
    })
  );

  if (nextItem) {
    updates.push(
      prisma.item.update({
        where: { id: nextItem.id },
        data: { status: 'ongoing' },
      })
    );
  }

  if (updates.length) {
    await prisma.$transaction(updates);
  }

  if (nextItem) {
    await startAutoTimer(roomId);
  } else {
    clearAutoTimer(roomId);
  }
  await emitRoomUpdate(roomId);
}

exports.getRooms = async (req, res) => {
  const organizerId = req.query.organizerId ? Number(req.query.organizerId) : null;
  const organizerCode = req.query.organizerCode ? String(req.query.organizerCode) : null;

  let organizer = null;

  if (organizerId && !Number.isNaN(organizerId)) {
    organizer = await prisma.organizer.findUnique({ where: { id: organizerId } });
  } else if (organizerCode) {
    organizer = await prisma.organizer.findUnique({ where: { organizerCode } });
  } else {
    organizer = await ensureDefaultOrganizer();
  }

  if (!organizer) {
    return res.status(404).json({ error: 'Organizer not found' });
  }

  const rooms = await prisma.auctionRoom.findMany({
    where: { organizerId: organizer.id },
    include: { participants: true, items: true },
    orderBy: { id: 'asc' },
  });
  res.json(rooms);
};

exports.createRoom = async (req, res) => {
  const { roomName, organizerId, organizerCode } = req.body;
  if (!roomName || !roomName.trim()) {
    return res.status(400).json({ error: 'roomName is required' });
  }
  let organizer = null;

  if (organizerId && !Number.isNaN(Number(organizerId))) {
    organizer = await prisma.organizer.findUnique({ where: { id: Number(organizerId) } });
  } else if (organizerCode) {
    organizer = await prisma.organizer.findUnique({ where: { organizerCode: String(organizerCode) } });
  } else {
    organizer = await ensureDefaultOrganizer();
  }

  if (!organizer) {
    return res.status(404).json({ error: 'Organizer not found' });
  }

  const room = await prisma.auctionRoom.create({
    data: { roomName: roomName.trim(), organizerId: organizer.id },
  });
  return res.status(201).json(room);
};

exports.getRoom = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  const room = await getRoomSnapshot(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  return res.json(withAutoMeta(room));
};

exports.startAuction = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.status === 'live') {
    return res.status(400).json({ error: 'Auction already live' });
  }

  await prisma.auctionRoom.update({
    where: { id: roomId },
    data: { status: 'live' },
  });

  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

async function finalizeCurrentItem(room) {
  if (!room.currentItemId) return [];

  const currentItem = await prisma.item.findUnique({ where: { id: room.currentItemId } });
  if (!currentItem || currentItem.status !== 'ongoing') return [];

  const sold = !!currentItem.winnerId;
  const updates = [
    prisma.item.update({
      where: { id: currentItem.id },
      data: { status: sold ? 'sold' : 'unsold' },
    }),
    prisma.auctionRoom.update({
      where: { id: room.id },
      data: { currentItemId: null },
    }),
  ];

  if (sold && currentItem.currentBid != null) {
    updates.push(
      prisma.participant.update({
        where: { id: currentItem.winnerId },
        data: { remainingPurse: { decrement: currentItem.currentBid } },
      })
    );
  }

  return updates;
}

exports.selectItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { itemId } = req.body;
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const parsedItemId = Number(itemId);
  if (Number.isNaN(parsedItemId)) {
    return res.status(400).json({ error: 'Valid item id is required' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.status !== 'live') {
    return res.status(400).json({ error: 'Start the auction first' });
  }

  if (room.currentItemId) {
    return res.status(400).json({ error: 'Stop the current item before selecting another' });
  }

  const selectedItem = room.items.find((item) => item.id === parsedItemId);
  if (!selectedItem || selectedItem.status !== 'upcoming') {
    return res.status(400).json({ error: 'Selected item is not available' });
  }

  await prisma.$transaction([
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: { currentItemId: selectedItem.id },
    }),
    prisma.item.update({
      where: { id: selectedItem.id },
      data: { status: 'ongoing' },
    }),
  ]);

  await startAutoTimer(roomId);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.stopCurrentItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room || !room.currentItemId) {
    return res.status(400).json({ error: 'No current item to stop' });
  }

  const updates = await finalizeCurrentItem(room);
  if (updates.length) {
    await prisma.$transaction(updates);
  }

  clearAutoTimer(roomId);
  const config = getAutoConfig(roomId);
  if (config.enabled) {
    await runAutoProgression(roomId);
  }

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.endAuction = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const updates = await finalizeCurrentItem(room);
  updates.push(
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: { status: 'ended', currentItemId: null },
    })
  );

  await prisma.$transaction(updates);
  clearAutoTimer(roomId);
  if (boughtOrderByRoom.has(roomId)) {
    boughtOrderByRoom.delete(roomId);
  }
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.skipItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room || !room.currentItemId) {
    return res.status(400).json({ error: 'No current item to skip' });
  }

  const currentItemId = room.currentItemId;
  const nextItem = room.items.find((item) => item.status === 'upcoming');

  await prisma.$transaction([
    prisma.item.update({
      where: { id: currentItemId },
      data: { status: 'unsold' },
    }),
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: { currentItemId: nextItem ? nextItem.id : null, status: nextItem ? 'live' : 'ended' },
    }),
    ...(nextItem
      ? [
          prisma.item.update({
            where: { id: nextItem.id },
            data: { status: 'ongoing' },
          }),
        ]
      : []),
  ]);

  await startAutoTimer(roomId);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.nextItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room || !room.currentItemId) {
    return res.status(400).json({ error: 'No current item to advance' });
  }

  const currentItem = room.items.find((item) => item.id === room.currentItemId);
  const nextItem = room.items.find((item) => item.status === 'upcoming');

  const updates = [];

  if (currentItem) {
    const sold = !!currentItem.winnerId;
    updates.push(
      prisma.item.update({
        where: { id: currentItem.id },
        data: { status: sold ? 'sold' : 'unsold' },
      })
    );

    if (sold && currentItem.currentBid != null) {
      updates.push(
        prisma.participant.update({
          where: { id: currentItem.winnerId },
          data: { remainingPurse: { decrement: currentItem.currentBid } },
        })
      );
    }
  }

  updates.push(
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: { currentItemId: nextItem ? nextItem.id : null, status: nextItem ? 'live' : 'ended' },
    })
  );

  if (nextItem) {
    updates.push(
      prisma.item.update({ where: { id: nextItem.id }, data: { status: 'ongoing' } })
    );
  }

  await prisma.$transaction(updates);

  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.configureAutoAuction = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const enabled = !!req.body.enabled;
  const parsedWindow = Number(req.body.bidWindowSeconds);

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (enabled) {
    if (Number.isNaN(parsedWindow) || parsedWindow < 3) {
      return res.status(400).json({ error: 'bidWindowSeconds must be at least 3 seconds' });
    }
    autoConfigByRoom.set(roomId, { enabled: true, bidWindowSeconds: parsedWindow });
    await startAutoTimer(roomId);
  } else {
    autoConfigByRoom.set(roomId, { enabled: false, bidWindowSeconds: 0 });
    clearAutoTimer(roomId);
    await emitRoomUpdate(roomId);
  }

  const updatedRoom = await getRoomSnapshot(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.handleBidPlaced = async (roomId) => {
  await startAutoTimer(roomId);
  await emitRoomUpdate(roomId);
};

exports.setBoughtItemOrder = setBoughtItemOrder;

exports.getRoomSnapshot = getRoomSnapshot;
exports.emitRoomUpdate = emitRoomUpdate;
