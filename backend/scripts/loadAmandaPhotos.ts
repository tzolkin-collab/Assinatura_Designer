// Sobe para a biblioteca da Amanda Coelho as fotos reais dela (as que a Gabriela mandou por WhatsApp).
//
//   pnpm exec tsx scripts/loadAmandaPhotos.ts --dir "<pasta com as fotos>"            simula
//   pnpm exec tsx scripts/loadAmandaPhotos.ts --dir "<pasta com as fotos>" --apply    envia
//
// Aceita .jpg .jpeg .png .webp. Cada foto é orientada pelo EXIF (celular) e limitada a 3000 px no maior lado,
// sem alterar o conteúdo: é a MESMA foto, só reduzida. Idempotente: foto que já está na biblioteca (mesmo nome)
// não é enviada de novo. Vídeos e .heic são avisados e ignorados.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import prisma from '../src/lib/prisma.js';
import { uploadFileToR2 } from '../src/lib/r2.js';

const SLUG = 'amanda-coelho';
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = arg('--dir');
const apply = process.argv.includes('--apply');
const OK = /\.(jpe?g|png|webp)$/i;

async function main() {
  if (!dir) throw new Error('Informe --dir com a pasta das fotos.');
  const brand = await prisma.brand.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!brand) throw new Error(`Projeto "${SLUG}" não existe neste banco.`);

  const todos = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  const ignorados = todos.filter((f) => !OK.test(f));
  const fotos = todos.filter((f) => OK.test(f)).sort();
  for (const f of ignorados) console.log(`  ignorado (formato não aceito): ${f}`);
  if (fotos.length === 0) throw new Error('Nenhuma foto .jpg/.png/.webp na pasta.');

  const nomeDe = (f: string) => `Foto real — ${f}`;
  const existentes = new Set((await prisma.asset.findMany({ where: { brandId: brand.id, name: { in: fotos.map(nomeDe) } }, select: { name: true } })).map((a) => a.name));
  console.log(`Projeto: ${brand.name}. ${fotos.length} foto(s) na pasta, ${existentes.size} já na biblioteca.`);

  for (const f of fotos) {
    const nome = nomeDe(f);
    const bruto = fs.readFileSync(path.join(dir, f));
    const meta = await sharp(bruto).metadata();
    console.log(`  ${existentes.has(nome) ? 'já existe ' : 'enviar    '} ${nome} (${meta.width}x${meta.height}, ${Math.round(bruto.length / 1024)} KB)`);
    if (!apply || existentes.has(nome)) continue;

    const pronta = await sharp(bruto).rotate().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    const base = f.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
    const url = await uploadFileToR2(pronta.data, `amanda-foto-${base}.jpg`, 'image/jpeg', `brands/${brand.id}`);
    await prisma.asset.create({
      data: {
        brandId: brand.id,
        name: nome,
        url,
        fileType: 'image/jpeg',
        sizeBytes: pronta.data.length,
        width: pronta.info.width,
        height: pronta.info.height,
        source: 'upload',
        tags: ['foto-real'],
      },
    });
    console.log(`    enviada: ${nome}`);
  }
  if (!apply) console.log('Simulação: nada foi enviado. Rode com --apply.');
}

main()
  .catch((e) => {
    console.error('ERRO', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
