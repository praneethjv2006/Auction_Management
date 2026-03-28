const prisma = require('../lib/prisma');
const { getIo } = require('../lib/socketStore');
const { ensureDefaultOrganizer } = require('./organizerController');
const { AuctionSystem } = require('../models/singleton');
const { AuctionFactory } = require('../models/factory');

const auctionSystem = AuctionSystem.getInstance();
const autoConfigByRoom = auctionSystem.autoConfigByRoom;
const autoTimerByRoom = auctionSystem.autoTimerByRoom;
const autoDeadlineByRoom = auctionSystem.autoDeadlineByRoom;
const boughtOrderByRoom = auctionSystem.boughtOrderByRoom;
const skipVotesByRoom = auctionSystem.skipVotesByRoom;

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

  const skipState = skipVotesByRoom.get(room.id);
  const skippedParticipantIds = skipState
    ? Array.from(skipState.participantIds)
    : [];

  return {
    ...roomWithOrder,
    autoAuction: getAutoMeta(room.id),
    boughtItemOrderByParticipant: getBoughtOrderState(room.id),
    skipState: {
      itemId: skipState ? skipState.itemId : null,
      participantIds: skippedParticipantIds,
      participantNames: roomWithOrder.participants
        .filter((participant) => skippedParticipantIds.includes(participant.id))
        .map((participant) => participant.name),
    },
  };
}

function clearSkipVotes(roomId) {
  if (skipVotesByRoom.has(roomId)) {
    skipVotesByRoom.delete(roomId);
  }
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
      categories: { orderBy: { name: 'asc' } },
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

  clearSkipVotes(roomId);
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
    include: {
      participants: true,
      categories: { orderBy: { name: 'asc' } },
      items: true,
    },
    orderBy: { id: 'asc' },
  });
  res.json(rooms);
};

exports.addRoomCategory = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const name = String(req.body.name || '').trim();

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const existing = await prisma.roomCategory.findFirst({
    where: {
      roomId,
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
  });

  if (existing) {
    return res.status(409).json({ error: 'Category already exists in this room' });
  }

  const category = await prisma.roomCategory.create({
    data: {
      name,
      roomId,
    },
  });

  await emitRoomUpdate(roomId);
  return res.status(201).json(category);
};

exports.deleteRoomCategory = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const categoryId = Number(req.params.categoryId);

  if (Number.isNaN(roomId) || Number.isNaN(categoryId)) {
    return res.status(400).json({ error: 'Invalid room or category id' });
  }

  const category = await prisma.roomCategory.findFirst({
    where: {
      id: categoryId,
      roomId,
    },
  });

  if (!category) {
    return res.status(404).json({ error: 'Category not found in this room' });
  }

  await prisma.$transaction([
    prisma.item.updateMany({
      where: {
        auctionRoomId: roomId,
        category: category.name,
      },
      data: {
        category: 'General',
      },
    }),
    prisma.roomCategory.delete({
      where: { id: categoryId },
    }),
  ]);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
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

  const roomData = AuctionFactory.createAuctionRoom({
    roomName,
    organizerId: organizer.id,
  });

  const room = await prisma.auctionRoom.create({
    data: roomData,
  });
  auctionSystem.registerRoom(room);
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

  clearSkipVotes(roomId);
  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

async function finalizeCurrentItem(room) {
  if (!room.currentItemId) return [];

  const currentItem = await prisma.item.findUnique({ where: { id: room.currentItemId } });
  if (!currentItem || currentItem.status !== 'ongoing') return [];

  const itemState = AuctionFactory.createItemState(currentItem.status);
  const nextStatus = itemState.declareWinner(currentItem);
  const sold = nextStatus === 'sold';
  const updates = [
    prisma.item.update({
      where: { id: currentItem.id },
      data: { status: nextStatus },
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

  clearSkipVotes(roomId);
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
  clearSkipVotes(roomId);
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
  clearSkipVotes(roomId);
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
  const autoConfig = getAutoConfig(roomId);
  const nextItem = autoConfig.enabled
    ? pickRandomUpcomingItem(room.items)
    : room.items.find((item) => item.status === 'upcoming');

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

  clearSkipVotes(roomId);
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
  const autoConfig = getAutoConfig(roomId);
  const nextItem = autoConfig.enabled
    ? pickRandomUpcomingItem(room.items)
    : room.items.find((item) => item.status === 'upcoming');

  const updates = [];

  if (currentItem) {
    const itemState = AuctionFactory.createItemState(currentItem.status);
    const nextStatus = itemState.declareWinner(currentItem);
    const sold = nextStatus === 'sold';
    updates.push(
      prisma.item.update({
        where: { id: currentItem.id },
        data: { status: nextStatus },
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

  clearSkipVotes(roomId);
  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.configureAutoAuction = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const enabled = !!req.body.enabled;
  const parsedWindow = Number(req.body.bidWindowSeconds);
  const minBidWindow = auctionSystem.getConfig().bidWindowSecondsMin;

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      items: { orderBy: { id: 'asc' } },
    },
  });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (enabled && room.status === 'ended') {
    return res.status(400).json({ error: 'Cannot enable automatic auction on an ended room. Restart the auction first.' });
  }

  if (enabled) {
    if (Number.isNaN(parsedWindow) || parsedWindow < minBidWindow) {
      return res.status(400).json({ error: `bidWindowSeconds must be at least ${minBidWindow} seconds` });
    }
    autoConfigByRoom.set(roomId, { enabled: true, bidWindowSeconds: parsedWindow });

    // Do not auto-pick the first item on enable.
    // The organizer must explicitly trigger the first random item.
    await startAutoTimer(roomId);
  } else {
    autoConfigByRoom.set(roomId, { enabled: false, bidWindowSeconds: 0 });
    clearAutoTimer(roomId);
    await emitRoomUpdate(roomId);
  }

  const updatedRoom = await getRoomSnapshot(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.startAutoFirstItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const config = getAutoConfig(roomId);
  if (!config.enabled) {
    return res.status(400).json({ error: 'Automatic auction is not enabled' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.status === 'ended') {
    return res.status(400).json({ error: 'Cannot start automatic auction on an ended room. Restart the auction first.' });
  }

  if (room.status !== 'live') {
    return res.status(400).json({ error: 'Start the auction first' });
  }

  if (room.currentItemId) {
    return res.status(400).json({ error: 'A current item is already active' });
  }

  const nextItem = pickRandomUpcomingItem(room.items);
  if (!nextItem) {
    return res.status(400).json({ error: 'No upcoming items available' });
  }

  await prisma.$transaction([
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: { currentItemId: nextItem.id, status: 'live' },
    }),
    prisma.item.update({
      where: { id: nextItem.id },
      data: { status: 'ongoing' },
    }),
  ]);

  clearSkipVotes(roomId);
  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.restartAuction = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const mode = String(req.body.mode || 'same');

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      participants: { orderBy: { id: 'asc' } },
      items: { select: { id: true, price: true } },
    },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const participantUpdates = [];

  if (mode === 'individual') {
    const participantPurses = Array.isArray(req.body.participantPurses)
      ? req.body.participantPurses
      : [];

    const purseByParticipant = new Map();
    for (const entry of participantPurses) {
      const participantId = Number(entry.participantId);
      const purseAmount = Number(entry.purseAmount);
      if (Number.isNaN(participantId) || Number.isNaN(purseAmount) || purseAmount < 0) {
        return res.status(400).json({ error: 'Invalid participant purse payload' });
      }
      purseByParticipant.set(participantId, purseAmount);
    }

    const hasAllParticipants = room.participants.every((participant) => purseByParticipant.has(participant.id));
    if (!hasAllParticipants) {
      return res.status(400).json({ error: 'Purse value is required for each participant' });
    }

    for (const participant of room.participants) {
      const purseAmount = purseByParticipant.get(participant.id);
      participantUpdates.push(
        prisma.participant.update({
          where: { id: participant.id },
          data: {
            purseAmount,
            remainingPurse: purseAmount,
          },
        })
      );
    }
  } else {
    const purseAmount = Number(req.body.purseAmount);
    if (Number.isNaN(purseAmount) || purseAmount < 0) {
      return res.status(400).json({ error: 'Valid purseAmount is required' });
    }

    for (const participant of room.participants) {
      participantUpdates.push(
        prisma.participant.update({
          where: { id: participant.id },
          data: {
            purseAmount,
            remainingPurse: purseAmount,
          },
        })
      );
    }
  }

  clearAutoTimer(roomId);
  clearSkipVotes(roomId);
  autoConfigByRoom.set(roomId, { enabled: false, bidWindowSeconds: 0 });
  if (boughtOrderByRoom.has(roomId)) {
    boughtOrderByRoom.delete(roomId);
  }

  const itemResetUpdates = room.items.map((item) => (
    prisma.item.update({
      where: { id: item.id },
      data: {
        status: 'upcoming',
        winnerId: null,
        currentBid: item.price,
        firstBid: item.price,
      },
    })
  ));

  await prisma.$transaction([
    prisma.bid.deleteMany({
      where: {
        item: {
          auctionRoomId: roomId,
        },
      },
    }),
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: {
        status: 'waiting',
        currentItemId: null,
      },
    }),
    ...participantUpdates,
    ...itemResetUpdates,
  ]);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.updateParticipant = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const participantId = Number(req.params.participantId);

  if (Number.isNaN(roomId) || Number.isNaN(participantId)) {
    return res.status(400).json({ error: 'Invalid room or participant id' });
  }

  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
      roomId,
    },
  });

  if (!participant) {
    return res.status(404).json({ error: 'Participant not found in this room' });
  }

  const updateData = {};

  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Participant name cannot be empty' });
    updateData.name = name;
  }

  if (req.body.email != null) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Valid participant email is required' });
    }
    updateData.email = email;
  }

  if (req.body.purseAmount != null) {
    const purseAmount = Number(req.body.purseAmount);
    if (Number.isNaN(purseAmount) || purseAmount < 0) {
      return res.status(400).json({ error: 'Valid purse amount is required' });
    }
    updateData.purseAmount = purseAmount;
    updateData.remainingPurse = purseAmount;
  }

  if (!Object.keys(updateData).length) {
    return res.status(400).json({ error: 'No participant fields provided for update' });
  }

  await prisma.participant.update({
    where: { id: participantId },
    data: updateData,
  });

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.updateItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(roomId) || Number.isNaN(itemId)) {
    return res.status(400).json({ error: 'Invalid room or item id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      categories: { orderBy: { name: 'asc' } },
      items: {
        where: { id: itemId },
      },
    },
  });

  if (!room || !room.items.length) {
    return res.status(404).json({ error: 'Item not found in this room' });
  }

  const updateData = {};

  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Item name cannot be empty' });
    updateData.name = name;
  }

  if (req.body.price != null) {
    const price = Number(req.body.price);
    if (Number.isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Valid price is required' });
    }
    updateData.price = price;
  }

  if (req.body.category != null) {
    const category = String(req.body.category).trim();
    if (!category) {
      return res.status(400).json({ error: 'Category cannot be empty' });
    }

    if (room.categories.length > 0) {
      const allowedCategory = room.categories.find(
        (entry) => entry.name.toLowerCase() === category.toLowerCase()
      );

      if (!allowedCategory) {
        return res.status(400).json({
          error: 'Category must be selected from room categories configured by organizer',
        });
      }
    }

    updateData.category = category;
  }

  if (!Object.keys(updateData).length) {
    return res.status(400).json({ error: 'No item fields provided for update' });
  }

  await prisma.item.update({
    where: { id: itemId },
    data: updateData,
  });

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.deleteItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(roomId) || Number.isNaN(itemId)) {
    return res.status(400).json({ error: 'Invalid room or item id' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const item = await prisma.item.findFirst({
    where: { id: itemId, auctionRoomId: roomId },
  });

  if (!item) {
    return res.status(404).json({ error: 'Item not found in this room' });
  }

  const updates = [];

  if (item.winnerId && item.currentBid != null) {
    updates.push(
      prisma.participant.update({
        where: { id: item.winnerId },
        data: { remainingPurse: { increment: item.currentBid } },
      })
    );
  }

  if (room.currentItemId === item.id) {
    updates.push(
      prisma.auctionRoom.update({
        where: { id: roomId },
        data: { currentItemId: null },
      })
    );
    clearAutoTimer(roomId);
    clearSkipVotes(roomId);
  }

  updates.push(
    prisma.bid.deleteMany({ where: { itemId } }),
    prisma.item.delete({ where: { id: itemId } })
  );

  await prisma.$transaction(updates);

  if (boughtOrderByRoom.has(roomId)) {
    const roomMap = boughtOrderByRoom.get(roomId);
    for (const [participantId, itemIds] of roomMap.entries()) {
      roomMap.set(participantId, itemIds.filter((id) => id !== itemId));
    }
  }

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.deleteRoom = async (req, res) => {
  const roomId = Number(req.params.roomId);

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      items: { select: { id: true } },
    },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  clearAutoTimer(roomId);
  clearSkipVotes(roomId);
  autoConfigByRoom.delete(roomId);
  if (boughtOrderByRoom.has(roomId)) {
    boughtOrderByRoom.delete(roomId);
  }

  await prisma.$transaction([
    prisma.bid.deleteMany({
      where: {
        item: {
          auctionRoomId: roomId,
        },
      },
    }),
    prisma.item.deleteMany({ where: { auctionRoomId: roomId } }),
    prisma.participant.deleteMany({ where: { roomId } }),
    prisma.roomCategory.deleteMany({ where: { roomId } }),
    prisma.auctionRoom.delete({ where: { id: roomId } }),
  ]);

  return res.json({ ok: true });
};

exports.reassignItem = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const itemId = Number(req.params.itemId);
  const newWinnerId = req.body.newWinnerId == null ? null : Number(req.body.newWinnerId);
  const desiredStatus = req.body.status ? String(req.body.status) : null;

  if (Number.isNaN(roomId) || Number.isNaN(itemId) || (newWinnerId != null && Number.isNaN(newWinnerId))) {
    return res.status(400).json({ error: 'Invalid room, item, or participant id' });
  }

  if (desiredStatus && !['unsold', 'sold', 'upcoming'].includes(desiredStatus)) {
    return res.status(400).json({ error: 'Invalid status for reassignment' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      items: true,
      participants: true,
    },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const item = room.items.find((entry) => entry.id === itemId);
  if (!item) {
    return res.status(404).json({ error: 'Item not found in this room' });
  }

  if (newWinnerId != null && !room.participants.some((entry) => entry.id === newWinnerId)) {
    return res.status(404).json({ error: 'New winner is not a participant in this room' });
  }

  const nextStatus = desiredStatus
    ? desiredStatus
    : (item.status === 'ongoing'
      ? 'ongoing'
      : (newWinnerId == null ? 'unsold' : 'sold'));

  let nextWinnerId = newWinnerId;
  if (nextStatus === 'sold') {
    if (nextWinnerId == null) {
      return res.status(400).json({ error: 'Participant is required when status is sold' });
    }
  } else if (nextStatus === 'unsold' || nextStatus === 'upcoming') {
    nextWinnerId = null;
  }

  const bidAmount = item.currentBid ?? item.price ?? 0;
  const updates = [];

  if (item.winnerId) {
    updates.push(
      prisma.participant.update({
        where: { id: item.winnerId },
        data: { remainingPurse: { increment: bidAmount } },
      })
    );
  }

  if (nextWinnerId != null) {
    const nextWinner = room.participants.find((entry) => entry.id === nextWinnerId);
    if (!nextWinner) {
      return res.status(404).json({ error: 'New winner not found in room' });
    }

    if (nextWinner.remainingPurse < bidAmount) {
      return res.status(400).json({ error: 'Selected participant does not have enough remaining purse' });
    }

    updates.push(
      prisma.participant.update({
        where: { id: nextWinnerId },
        data: { remainingPurse: { decrement: bidAmount } },
      })
    );
  }

  if (nextStatus === 'upcoming') {
    updates.push(
      prisma.item.update({
        where: { id: item.id },
        data: {
          winnerId: null,
          status: 'upcoming',
          currentBid: item.price,
          firstBid: item.price,
        },
      })
    );

    if (room.currentItemId === item.id) {
      updates.push(
        prisma.auctionRoom.update({
          where: { id: roomId },
          data: { currentItemId: null, status: room.status },
        })
      );
      clearAutoTimer(roomId);
      clearSkipVotes(roomId);
    }
  } else {
    updates.push(
      prisma.item.update({
        where: { id: item.id },
        data: {
          winnerId: nextWinnerId,
          status: nextStatus,
        },
      })
    );
  }

  await prisma.$transaction(updates);

  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

exports.previousItem = async (req, res) => {
  const roomId = Number(req.params.roomId);

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: {
      items: { orderBy: { id: 'desc' } },
    },
  });

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.currentItemId) {
    return res.status(400).json({ error: 'Stop current item before restarting previous item' });
  }

  const previous = room.items.find((item) => item.status === 'sold' || item.status === 'unsold');
  if (!previous) {
    return res.status(400).json({ error: 'No previous completed item found' });
  }

  const updates = [];

  if (previous.winnerId && previous.currentBid != null) {
    updates.push(
      prisma.participant.update({
        where: { id: previous.winnerId },
        data: { remainingPurse: { increment: previous.currentBid } },
      })
    );
  }

  updates.push(
    prisma.bid.deleteMany({ where: { itemId: previous.id } }),
    prisma.item.update({
      where: { id: previous.id },
      data: {
        status: 'ongoing',
        winnerId: null,
        currentBid: previous.price,
        firstBid: previous.price,
      },
    }),
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: {
        status: 'live',
        currentItemId: previous.id,
      },
    })
  );

  await prisma.$transaction(updates);

  clearSkipVotes(roomId);
  await startAutoTimer(roomId);
  const updatedRoom = await getRoomSnapshot(roomId);
  await emitRoomUpdate(roomId);
  return res.json(withAutoMeta(updatedRoom));
};

async function progressSkip(roomId) {
  const room = await prisma.auctionRoom.findUnique({
    where: { id: roomId },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!room || !room.currentItemId) return;

  const currentItemId = room.currentItemId;
  const nextItem = room.items.find((item) => item.status === 'upcoming');

  await prisma.$transaction([
    prisma.item.update({
      where: { id: currentItemId },
      data: {
        status: 'unsold',
        winnerId: null,
      },
    }),
    prisma.auctionRoom.update({
      where: { id: roomId },
      data: {
        currentItemId: nextItem ? nextItem.id : null,
        status: nextItem ? 'live' : 'ended',
      },
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

  clearSkipVotes(roomId);
  await startAutoTimer(roomId);
  await emitRoomUpdate(roomId);
}

exports.participantSkipItem = async (roomId, participantId) => {
  const parsedRoomId = Number(roomId);
  const parsedParticipantId = Number(participantId);

  if (Number.isNaN(parsedRoomId) || Number.isNaN(parsedParticipantId)) {
    return { ok: false, status: 400, error: 'Invalid room or participant id' };
  }

  const room = await prisma.auctionRoom.findUnique({
    where: { id: parsedRoomId },
    include: {
      participants: true,
      currentItem: true,
    },
  });

  if (!room || !room.currentItemId || !room.currentItem) {
    return { ok: false, status: 400, error: 'No active item to skip' };
  }

  if (!room.participants.some((participant) => participant.id === parsedParticipantId)) {
    return { ok: false, status: 404, error: 'Participant not in room' };
  }

  let skipState = skipVotesByRoom.get(parsedRoomId);
  if (!skipState || skipState.itemId !== room.currentItemId) {
    skipState = {
      itemId: room.currentItemId,
      participantIds: new Set(),
    };
    skipVotesByRoom.set(parsedRoomId, skipState);
  }

  skipState.participantIds.add(parsedParticipantId);
  await emitRoomUpdate(parsedRoomId);

  if (skipState.participantIds.size >= room.participants.length) {
    await progressSkip(parsedRoomId);
    return { ok: true, skippedByAll: true };
  }

  return { ok: true, skippedByAll: false };
};

exports.hasParticipantSkippedCurrentItem = async (roomId, participantId) => {
  const parsedRoomId = Number(roomId);
  const parsedParticipantId = Number(participantId);
  if (Number.isNaN(parsedRoomId) || Number.isNaN(parsedParticipantId)) {
    return false;
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: parsedRoomId } });
  if (!room || !room.currentItemId) return false;

  const skipState = skipVotesByRoom.get(parsedRoomId);
  if (!skipState || skipState.itemId !== room.currentItemId) return false;
  return skipState.participantIds.has(parsedParticipantId);
};

exports.handleBidPlaced = async (roomId) => {
  await startAutoTimer(roomId);
  await emitRoomUpdate(roomId);
};

exports.setBoughtItemOrder = setBoughtItemOrder;

exports.getRoomSnapshot = getRoomSnapshot;
exports.emitRoomUpdate = emitRoomUpdate;
