import bcrypt from 'bcrypt';
import prisma from '../src/lib/prisma.js';

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10);
  const designerPassword = await bcrypt.hash('designer123', 10);

  // 1. Create Admin User
  const admin = await prisma.user.upsert({
    where: { email: 'admin@assinatura.com' },
    update: {},
    create: {
      email: 'admin@assinatura.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN',
    },
  });

  // 2. Create Designer User
  const designer = await prisma.user.upsert({
    where: { email: 'designer@assinatura.com' },
    update: {},
    create: {
      email: 'designer@assinatura.com',
      name: 'Designer User',
      password: designerPassword,
      role: 'DESIGNER',
    },
  });

  // 3. Create a Brand for the designer
  const brand = await prisma.brand.upsert({
    where: { slug: 'marca-exemplo' },
    update: {},
    create: {
      slug: 'marca-exemplo',
      name: 'Marca de Exemplo',
      color: '#171717',
      members: {
        create: { user: { connect: { id: designer.id } }, role: 'OWNER' }
      },
      config: {
        create: {
          agentPrompt: 'Você é um assistente de design para a Marca de Exemplo...',
          primaryFonts: ['Inter', 'Roboto'],
          colors: ['#171717', '#FFFFFF', '#FF0000'],
          guidelines: 'Use sempre o logo no canto superior direito.',
        }
      }
    },
  });

  console.log('Seed completed:');
  console.log({ admin, designer, brand });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
