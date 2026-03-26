const prisma = require('../lib/prisma');
const { emitRoomUpdate } = require('./roomController');
const { generateUniqueCode } = require('../lib/codeGenerator');
const { hasEmailConfig, canReturnDevPreview, sendMail } = require('../lib/mailer');
const { AuctionFactory } = require('../models/factory');
const { AuctionSystem } = require('../models/singleton');

const auctionSystem = AuctionSystem.getInstance();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

exports.addParticipant = async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { name, purseAmount, email } = req.body;
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
  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (normalizedEmail && !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'Valid participant email is required' });
  }

  const room = await prisma.auctionRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const participantCode = await generateUniqueCode(6, 'participant', 'participantCode');
  const participantData = AuctionFactory.createParticipant({
    name,
    participantCode,
    email: normalizedEmail,
    purseAmount: parsedPurseAmount,
    remainingPurse: parsedPurseAmount,
    roomId,
  });

  const participant = await prisma.participant.create({
    data: participantData,
  });
  auctionSystem.registerUser(participant);
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

exports.forgotRoomId = async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const participants = await prisma.participant.findMany({
    where: { email },
    include: {
      auctionRoom: true,
    },
    orderBy: { id: 'desc' },
  });

  if (!participants.length) {
    return res.status(404).json({ error: 'No participant account found for this email' });
  }

  const roomLines = participants
    .map((participant) => `Room ID: ${participant.roomId}, Participant ID: ${participant.participantCode}, Room: ${participant.auctionRoom.roomName}`)
    .join('\n');

  const htmlLines = participants
    .map((participant) => `<li><strong>Room ID:</strong> ${participant.roomId}, <strong>Participant ID:</strong> ${participant.participantCode}, <strong>Room:</strong> ${participant.auctionRoom.roomName}</li>`)
    .join('');

  if (hasEmailConfig()) {
    try {
      await sendMail({
        to: email,
        subject: 'Your Auction Room ID Details',
        text: `Your login details:\n${roomLines}`,
        html: `<p>Your login details:</p><ul>${htmlLines}</ul>`,
      });
      return res.json({ message: 'Room ID details sent to your email' });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to send room ID email' });
    }
  }

  if (canReturnDevPreview()) {
    return res.json({
      message: 'Room details recovered successfully in development mode.',
      roomDetailsPreview: participants.map((participant) => ({
        roomId: participant.roomId,
        participantCode: participant.participantCode,
        roomName: participant.auctionRoom.roomName,
      })),
    });
  }

  return res.status(500).json({ error: 'Email service is not configured.' });
};
