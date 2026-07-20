import '../src/config';
import prisma from '../src/lib/prisma';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Uso: npx tsx scripts/check-canva-status.ts <userId>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      canvaAccessToken: true,
      canvaRefreshToken: true,
      canvaTokenExpiry: true,
      canvaUserId: true,
      canvaOauthState: true,
      canvaOauthStateAt: true,
    },
  });
  if (!user) {
    console.log('Usuário não encontrado');
    return;
  }
  console.log(JSON.stringify({
    ...user,
    canvaAccessToken: user.canvaAccessToken ? '***' : null,
    canvaRefreshToken: user.canvaRefreshToken ? '***' : null,
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
