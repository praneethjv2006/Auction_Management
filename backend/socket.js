const { Server } = require('socket.io');
const prisma = require('./lib/prisma');
const { emitRoomUpdate, handleBidPlaced, setBoughtItemOrder } = require('./controllers/roomController');
const { setIo } = require('./lib/socketStore');

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

      const room = await prisma.auctionRoom.findUnique({ where: { id: parsedRoomId } });
      if (!room || !room.currentItemId) return;

      const item = await prisma.item.findUnique({ where: { id: room.currentItemId } });
      const participant = await prisma.participant.findUnique({ where: { id: Number(participantId) } });

      if (!item || !participant || item.status !== 'ongoing') return;

      if (item.winnerId === participant.id) {
        socket.emit('bid:error', { message: 'You already have the highest bid' });
        return;
      }

      const bidAmount = Number(amount);
      if (Number.isNaN(bidAmount) || bidAmount <= 0) return;
      if (item.currentBid != null && bidAmount <= item.currentBid) return;
      if (bidAmount > participant.remainingPurse) return;

      await prisma.$transaction([
        prisma.bid.create({
          data: {
            amount: bidAmount,
            participantId: participant.id,
            itemId: item.id,
          },
        }),
        prisma.item.update({
          where: { id: item.id },
          data: { currentBid: bidAmount, winnerId: participant.id },
        }),
      ]);

      await handleBidPlaced(parsedRoomId);
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
