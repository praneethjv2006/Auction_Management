const prisma = require('./prisma');

async function generateUniqueCode(length, model, field) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;

  while (true) {
    const code = String(Math.floor(Math.random() * (max - min + 1)) + min);
    const existing = await prisma[model].findFirst({
      where: { [field]: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
}

module.exports = { generateUniqueCode };
