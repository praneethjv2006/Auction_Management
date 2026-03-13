const prisma = require('../lib/prisma');
const { generateUniqueCode } = require('../lib/codeGenerator');

async function main() {
  const organizer = await prisma.organizer.findFirst();

  if (organizer) {
    console.log(`Organizer already exists with ID ${organizer.id} and code ${organizer.organizerCode}`);
    return;
  }

  const organizerCode = await generateUniqueCode(4, 'organizer', 'organizerCode');
  const createdOrganizer = await prisma.organizer.create({
    data: {
      name: 'Default Organizer',
      email: 'organizer@example.com',
      organizerCode,
    },
  });

  console.log(`Created organizer with ID ${createdOrganizer.id} and code ${createdOrganizer.organizerCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });