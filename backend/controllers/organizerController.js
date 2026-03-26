const prisma = require('../lib/prisma');
const { generateUniqueCode } = require('../lib/codeGenerator');
const { hasEmailConfig, canReturnDevPreview, sendMail } = require('../lib/mailer');

const otpByEmail = new Map();
const OTP_TTL_MS = 10 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function ensureDefaultOrganizer() {
  const existingOrganizer = await prisma.organizer.findFirst();
  if (existingOrganizer) return existingOrganizer;
  const organizerCode = await generateUniqueCode(4, 'organizer', 'organizerCode');
  return prisma.organizer.create({
    data: {
      name: 'Default Organizer',
      email: 'organizer@example.com',
      organizerCode,
    },
  });
}

exports.getOrganizer = async (req, res) => {
  const organizer = await ensureDefaultOrganizer();
  res.json(organizer);
};

exports.loginOrganizer = async (req, res) => {
  const { organizerCode } = req.body;
  if (!organizerCode || String(organizerCode).length !== 4) {
    return res.status(400).json({ error: 'Organizer ID must be 4 digits' });
  }

  const organizer = await prisma.organizer.findUnique({
    where: { organizerCode: String(organizerCode) },
  });

  if (!organizer) {
    return res.status(404).json({ error: 'Organizer not found' });
  }

  return res.json(organizer);
};

exports.requestSignupOtp = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normalizeEmail(req.body.email);

  if (!name) {
    return res.status(400).json({ error: 'Organizer name is required' });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const existingOrganizer = await prisma.organizer.findFirst({ where: { email } });
  if (existingOrganizer) {
    return res.status(409).json({ error: 'Organizer account already exists for this email' });
  }

  const otp = generateOtp();
  otpByEmail.set(email, {
    otp,
    name,
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  if (hasEmailConfig()) {
    try {
      await sendMail({
        to: email,
        subject: 'Your Auction Organizer OTP',
        text: `Your OTP for organizer signup is ${otp}. It is valid for 10 minutes.`,
        html: `<p>Your OTP for organizer signup is <strong>${otp}</strong>.</p><p>It is valid for 10 minutes.</p>`,
      });
      return res.json({ message: 'OTP sent to your email' });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to send OTP email' });
    }
  }

  if (canReturnDevPreview()) {
    return res.json({
      message: 'OTP sent successfully in development mode.',
      devOtp: otp,
    });
  }

  return res.status(500).json({ error: 'Email service is not configured.' });
};

exports.verifySignupOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const otpEntry = otpByEmail.get(email);
  if (!otpEntry) {
    return res.status(400).json({ error: 'OTP not requested or expired' });
  }

  if (Date.now() > otpEntry.expiresAt) {
    otpByEmail.delete(email);
    return res.status(400).json({ error: 'OTP expired. Request a new OTP.' });
  }

  if (otpEntry.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const existingOrganizer = await prisma.organizer.findFirst({ where: { email } });
  if (existingOrganizer) {
    otpByEmail.delete(email);
    return res.status(409).json({ error: 'Organizer account already exists for this email' });
  }

  const organizerCode = await generateUniqueCode(4, 'organizer', 'organizerCode');
  const organizer = await prisma.organizer.create({
    data: {
      name: otpEntry.name,
      email,
      organizerCode,
    },
  });

  otpByEmail.delete(email);
  return res.status(201).json(organizer);
};

exports.forgotOrganizerId = async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const organizer = await prisma.organizer.findFirst({ where: { email } });
  if (!organizer) {
    return res.status(404).json({ error: 'No organizer account found for this email' });
  }

  if (hasEmailConfig()) {
    try {
      await sendMail({
        to: email,
        subject: 'Your Auction Organizer ID',
        text: `Your organizer ID is ${organizer.organizerCode}.`,
        html: `<p>Your organizer ID is <strong>${organizer.organizerCode}</strong>.</p>`,
      });
      return res.json({ message: 'Organizer ID sent to your email' });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to send organizer ID email' });
    }
  }

  if (canReturnDevPreview()) {
    return res.json({
      message: 'Organizer ID recovered successfully in development mode.',
      organizerCodePreview: organizer.organizerCode,
    });
  }

  return res.status(500).json({ error: 'Email service is not configured.' });
};

exports.getTest = async (req, res) => {
  const organizer = await ensureDefaultOrganizer();
  res.json({ message: 'Auction backend is running!', organizer });
};

exports.ensureDefaultOrganizer = ensureDefaultOrganizer;
