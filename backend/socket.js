const { Server } = require('socket.io');
const prisma = require('./lib/prisma');
const {
  emitRoomUpdate,
  handleBidPlaced,
  setBoughtItemOrder,
  participantSkipItem,
  hasParticipantSkippedCurrentItem,
} = require('./controllers/roomController');
const { setIo } = require('./lib/socketStore');
const { AuctionFactory } = require('./models/factory');
const { processBidWithPatterns } = require('./models/bidFlow');

const presenceByRoom = new Map();

function getRoomPresence(roomId) {
  if (!presenceByRoom.has(roomId)) {
    presenceByRoom.set(roomId, new Map());
  }
  return presenceByRoom.get(roomId);
}

function buildPresencePayload(roomId) {
  const roomPresence = getRoomPresence(roomId);
  const participants = [];
  const organizers = [];

  for (const entry of roomPresence.values()) {
    if (entry.role === 'participant') {
      participants.push(entry);
    } else if (entry.role === 'organizer') {
      organizers.push(entry);
    }
  }

  return { participants, organizers };
}

function attachSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  setIo(io);

  io.on('connection', (socket) => {
    socket.on('joinRoom', async ({ roomId, role, participantId, organizerId, sessionId }) => {
      const parsedRoomId = Number(roomId);
      if (Number.isNaN(parsedRoomId)) {
        return;
      }

      const roomPresence = getRoomPresence(parsedRoomId);
      roomPresence.set(socket.id, {
        id: socket.id,
        role,
        participantId: participantId || null,
        organizerId: organizerId || null,
        sessionId: sessionId || socket.id,
        active: true,
      });

      socket.join(`room:${parsedRoomId}`);

      await emitRoomUpdate(parsedRoomId);
      io.to(`room:${parsedRoomId}`).emit('presence:update', buildPresencePayload(parsedRoomId));
    });

    socket.on('placeBid', async ({ roomId, participantId, amount }) => {
      const parsedRoomId = Number(roomId);
      if (Number.isNaN(parsedRoomId)) return;

      const room = await prisma.auctionRoom.findUnique({
        where: { id: parsedRoomId },
        include: {
          participants: { select: { id: true } },
        },
      });
      if (!room || !room.currentItemId) return;

      const item = await prisma.item.findUnique({ where: { id: room.currentItemId } });
      const participant = await prisma.participant.findUnique({ where: { id: Number(participantId) } });

      if (!item || !participant || item.status !== 'ongoing') return;

      const participantSkipped = await hasParticipantSkippedCurrentItem(parsedRoomId, participant.id);
      if (participantSkipped) {
        socket.emit('bid:error', { message: 'You skipped this item and cannot bid anymore' });
        return;
      }

      if (item.winnerId === participant.id) {
        socket.emit('bid:error', { message: 'You already have the highest bid' });
        return;
      }

      const bidAmount = Number(amount);
      if (Number.isNaN(bidAmount) || bidAmount <= 0) return;
      if (item.currentBid != null && bidAmount <= item.currentBid) return;
      if (bidAmount > participant.remainingPurse) return;

      const bidContext = processBidWithPatterns({
        roomId: parsedRoomId,
        item,
        participant,
        requestedAmount: bidAmount,
        participantIds: room.participants.map((entry) => entry.id),
        strategyType: 'manual',
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
          data: { currentBid: bidContext.bidAmount, winnerId: bidContext.winnerId },
        }),
      ]);

      await handleBidPlaced(parsedRoomId);
    });

    socket.on('participantSkipItem', async ({ roomId, participantId }) => {
      const parsedRoomId = Number(roomId);
      const parsedParticipantId = Number(participantId);
      if (Number.isNaN(parsedRoomId) || Number.isNaN(parsedParticipantId)) {
        socket.emit('skip:error', { message: 'Invalid skip payload' });
        return;
      }

      const roomPresence = getRoomPresence(parsedRoomId);
      const session = roomPresence.get(socket.id);
      if (!session || session.role !== 'participant' || Number(session.participantId) !== parsedParticipantId) {
        socket.emit('skip:error', { message: 'You can only skip from your own participant account' });
        return;
      }

      const result = await participantSkipItem(parsedRoomId, parsedParticipantId);
      if (!result.ok) {
        socket.emit('skip:error', { message: result.error || 'Skip failed' });
      }
    });

    socket.on('reorderBoughtItems', async ({ roomId, participantId, itemIds }) => {
      const parsedRoomId = Number(roomId);
      const parsedParticipantId = Number(participantId);
      if (Number.isNaN(parsedRoomId) || Number.isNaN(parsedParticipantId) || !Array.isArray(itemIds)) {
        socket.emit('order:error', { message: 'Invalid reorder payload' });
        return;
      }

      const roomPresence = getRoomPresence(parsedRoomId);
      const session = roomPresence.get(socket.id);
      if (!session || session.role !== 'participant' || Number(session.participantId) !== parsedParticipantId) {
        socket.emit('order:error', { message: 'You can only reorder your own items' });
        return;
      }

      const parsedItemIds = itemIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
      const result = await setBoughtItemOrder(parsedRoomId, parsedParticipantId, parsedItemIds);
      if (!result.ok) {
        socket.emit('order:error', { message: result.error || 'Failed to update order' });
      }
    });

    socket.on('disconnect', () => {
      for (const [roomId, roomPresence] of presenceByRoom.entries()) {
        if (roomPresence.has(socket.id)) {
          roomPresence.delete(socket.id);
          io.to(`room:${roomId}`).emit('presence:update', buildPresencePayload(roomId));
        }
      }
    });
  });

  return io;
}

module.exports = { attachSocket };
