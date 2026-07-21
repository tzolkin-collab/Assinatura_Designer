import prisma from './src/lib/prisma.js';

async function clean() {
  const assets = await prisma.asset.findMany({ where: { source: 'ai-generated' } });
  let deleted = 0;
  for (const a of assets) {
    if (!a.name.includes('imagem ia')) {
      await prisma.asset.delete({ where: { id: a.id } });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} old slides from gallery`);
}
clean().finally(() => prisma.$disconnect());
