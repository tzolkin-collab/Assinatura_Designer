// Carrega na biblioteca da Amanda Coelho os arquivos de fonte oficiais (Queens e Aeonik) e marca as duas
// famílias da ficha como "arquivo enviado" (source: 'custom' + fileUrl), para o sistema parar de substituir.
//
//   pnpm exec tsx scripts/loadAmandaFonts.ts --dir "<pasta com Queens/ e Aeonik/>"           simula
//   pnpm exec tsx scripts/loadAmandaFonts.ts --dir "<pasta com Queens/ e Aeonik/>" --apply   grava
//
// O sistema escolhe até 6 arquivos por família (pesos e itálico, mais a variável) e lê o peso de dentro de
// cada arquivo. Este script envia TODOS os arquivos das pastas Queens/ e Aeonik/ (.ttf/.otf).
// Idempotente: arquivo que já existe na biblioteca (mesmo nome) não é enviado de novo.
// Conteúdo conferido pelos 4 primeiros bytes, nunca só pela extensão.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma.js';
import { uploadFileToR2 } from '../src/lib/r2.js';
import { brandProfileSchema, type BrandProfileData } from '../src/lib/brandProfile.js';
import { fontMime, MAX_FONT_BYTES, readFontMeta, sniffFontFormat } from '../src/lib/customFonts.js';

const SLUG = 'amanda-coelho';
const apply = process.argv.includes('--apply');
const dirIdx = process.argv.indexOf('--dir');
const dir = dirIdx >= 0 ? process.argv[dirIdx + 1] : undefined;

const FAMILIES = [
  { family: 'Queens', folder: 'Queens', role: 'títulos, frases de impacto e palavras dominantes', primary: 'Queens-Regular.ttf' },
  { family: 'Aeonik', folder: 'Aeonik', role: 'textos funcionais, listas e informações de apoio', primary: 'Aeonik-Regular.otf' },
];

async function main() {
  if (!dir) throw new Error('Informe --dir com a pasta que contém Queens/ e Aeonik/.');
  const brand = await prisma.brand.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, profile: { select: { data: true } } } });
  if (!brand) throw new Error(`Projeto "${SLUG}" não existe neste banco.`);

  const planned = FAMILIES.flatMap((fam) => {
    const folder = path.join(dir, fam.folder);
    const files = fs.readdirSync(folder).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();
    if (files.length === 0) throw new Error(`Nenhum .ttf/.otf em ${folder}.`);
    return files.map((file) => {
      const buf = fs.readFileSync(path.join(folder, file));
      const format = sniffFontFormat(buf);
      if (!format) throw new Error(`${file} não é um arquivo de fonte válido.`);
      if (buf.length > MAX_FONT_BYTES) throw new Error(`${file} passa do limite de ${MAX_FONT_BYTES} bytes.`);
      const meta = readFontMeta(buf);
      return { ...fam, buf, format, name: file, weight: meta?.weight ?? '?', style: meta?.style ?? 'normal', isPrimary: file === fam.primary };
    });
  });

  const existing = await prisma.asset.findMany({ where: { brandId: brand.id, name: { in: planned.map((p) => p.name) } }, select: { name: true, url: true } });
  const have = new Map(existing.map((a) => [a.name, a.url]));
  console.log(`Projeto: ${brand.name}. ${planned.length} fontes planejadas, ${have.size} já estão na biblioteca.`);
  for (const p of planned) console.log(`  ${have.has(p.name) ? 'já existe ' : 'enviar    '} ${p.name} (${p.format}, peso ${p.weight}, ${p.style}, ${Math.round(p.buf.length / 1024)} KB) → família ${p.family}`);
  if (!apply) {
    console.log('Simulação: nada foi enviado nem gravado. Rode com --apply.');
    return;
  }

  const urls = new Map<string, string>(have);
  for (const p of planned) {
    if (urls.has(p.name)) continue;
    const mime = fontMime(p.format);
    const url = await uploadFileToR2(p.buf, p.name, mime, `brands/${brand.id}`);
    await prisma.asset.create({
      data: { brandId: brand.id, name: p.name, url, fileType: mime, sizeBytes: p.buf.length, source: 'branding', tags: ['font', p.family.toLowerCase()] },
    });
    urls.set(p.name, url);
    console.log(`  enviado: ${p.name}`);
  }

  // Ficha: o que a pessoa já preencheu em cada família é mantido; só passa a "arquivo enviado".
  const current = brandProfileSchema.parse(brand.profile?.data ?? {});
  const typography = [...(current.typography ?? [])];
  for (const fam of FAMILIES) {
    const primary = planned.find((p) => p.family === fam.family && p.isPrimary) ?? planned.find((p) => p.family === fam.family)!;
    const fileUrl = urls.get(primary.name)!;
    const i = typography.findIndex((t) => t.family.trim().toLowerCase() === fam.family.toLowerCase());
    if (i >= 0) typography[i] = { ...typography[i]!, source: 'custom', fileUrl };
    else typography.push({ family: fam.family, role: fam.role, source: 'custom', fileUrl });
  }
  const next: BrandProfileData = brandProfileSchema.parse({ ...current, typography });
  await prisma.brandProfile.upsert({
    where: { brandId: brand.id },
    create: { brandId: brand.id, data: next as Prisma.InputJsonValue },
    update: { data: next as Prisma.InputJsonValue },
  });
  console.log(`Ficha atualizada: ${FAMILIES.map((f) => f.family).join(' e ')} como "arquivo oficial enviado".`);
}

main()
  .catch((e) => {
    console.error('ERRO', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
