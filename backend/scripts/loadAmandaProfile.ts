// Carrega a ficha da Amanda Coelho (a memória da Gabriela, dividida nas seções da ficha) no projeto
// `amanda-coelho`.
//
//   pnpm exec tsx scripts/loadAmandaProfile.ts            simula: valida, relata e não grava nada
//   pnpm exec tsx scripts/loadAmandaProfile.ts --apply    grava SE o projeto ainda não tem ficha
//   pnpm exec tsx scripts/loadAmandaProfile.ts --apply --force   sobrescreve a ficha existente
//
// Pré-requisito: as migrations `add_brand_collab` e `add_brand_profile` aplicadas no banco.
// Depois de gravar, o cérebro da Amanda passa a ler a ficha (e não mais o seed).
import 'dotenv/config';
import type { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma.js';
import { AMANDA_COELHO_PROFILE } from '../src/lib/designerBrain/seeds/amandaCoelhoProfile.js';
import { planProfileLoad, reportProfile } from '../src/lib/brandProfileLoad.js';

const SLUG = 'amanda-coelho';
const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');

async function main() {
  const report = reportProfile(AMANDA_COELHO_PROFILE);
  if (!report.valid || !report.data) {
    console.error('Ficha inválida:\n- ' + report.errors.join('\n- '));
    process.exit(1);
  }
  console.log(`Ficha válida: ${report.percent}% preenchida; pronta: ${report.ready ? 'sim' : 'não'}.`);
  if (report.pendingRequired.length) console.log(`Obrigatórias pendentes (precisam de arquivo na biblioteca): ${report.pendingRequired.join(', ')}.`);

  let brand;
  try {
    brand = await prisma.brand.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, profile: { select: { id: true } } } });
  } catch (err) {
    console.error(
      'Não consegui ler o projeto no banco. As migrations da ficha já foram aplicadas? ' +
        `(${err instanceof Error ? err.message.split('\n').pop() : 'erro desconhecido'})`,
    );
    process.exit(1);
  }
  if (!brand) {
    console.error(`Projeto "${SLUG}" não existe neste banco: nada a carregar.`);
    process.exit(1);
  }

  const action = planProfileLoad({ existing: brand.profile, force });
  console.log(`Projeto: ${brand.name}. Ação: ${action}.`);

  if (action === 'refuse-exists') {
    console.error('O projeto já tem uma ficha salva. Não vou sobrescrever sem --force.');
    process.exit(1);
  }
  if (!apply) {
    console.log('Simulação: nada foi gravado. Rode com --apply para gravar.');
    return;
  }

  await prisma.brandProfile.upsert({
    where: { brandId: brand.id },
    create: { brandId: brand.id, data: report.data as Prisma.InputJsonValue },
    update: { data: report.data as Prisma.InputJsonValue },
  });
  console.log('Ficha gravada. O cérebro da Amanda agora lê a ficha.');
}

main()
  .catch((e) => {
    console.error('ERRO', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
