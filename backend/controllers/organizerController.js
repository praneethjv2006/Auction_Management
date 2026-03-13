const prisma = require('../lib/prisma');
const { generateUniqueCode } = require('../lib/codeGenerator');

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

exports.getTest = async (req, res) => {
  const organizer = await ensureDefaultOrganizer();
  res.json({ message: 'Auction backend is running!', organizer });
};

exports.ensureDefaultOrganizer = ensureDefaultOrganizer;
