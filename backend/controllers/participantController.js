const prisma = require('../lib/prisma');
const { emitRoomUpdate } = require('./roomController');
const { generateUniqueCode } = require('../lib/codeGenerator');

exports.addParticipant = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { name, purseAmount } = req.body;
  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room id' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Participant name is required' });
  }
  const parsedPurseAmount = Number(purseAmount);
  if (Number.isNaN(parsedPurseAmount) || parsedPurseAmount < 0) {
    return res.status(400).json({ error: 'Valid purseAmount is required' });
  }
  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const participantCode = await generateUniqueCode(6, 'participant', 'participantCode');
  const participant = await prisma.participant.create({
    data: {
      name: name.trim(),
      participantCode,
      purseAmount: parsedPurseAmount,
      remainingPurse: parsedPurseAmount,
      roomId,
    },
  });
  await emitRoomUpdate(roomId);
  return res.status(201).json(participant);
};

exports.loginParticipant = async (req, res) => {
  const { participantCode, roomId } = req.body;
  const parsedRoomId = Number(roomId);

  if (!participantCode || String(participantCode).length !== 6) {
    return res.status(400).json({ error: 'Participant ID must be 6 digits' });
  }

  if (Number.isNaN(parsedRoomId)) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  const participant = await prisma.participant.findFirst({
    where: {
      participantCode: String(participantCode),
      roomId: parsedRoomId,
    },
  });

  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  return res.json(participant);
};
