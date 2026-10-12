// Carrega na biblioteca da Amanda Coelho os ativos oficiais que a Gabriela mandou (pasta "AMANDA COELHO"
// do Drive: logos em PDF, moodboards, fonte e paleta em imagem) e liga cada um à ficha do projeto:
// logo (14 variantes), manual visual, imagem de referência das fontes.
//
//   pnpm exec tsx scripts/loadAmandaAssets.ts --files "<pasta AMANDA COELHO>" --logos "<pasta com p1..p14.png>"          simula
//   pnpm exec tsx scripts/loadAmandaAssets.ts --files "<...>" --logos "<...>" --apply                                    grava
//
// `--logos` é a pasta com as 14 páginas do PDF de logos já extraídas em PNG (p1.png ... p14.png).
// Idempotente: ativo que já existe na biblioteca (mesmo nome) não é enviado de novo.
// Nada é inventado: os nomes vêm da cor medida em cada arquivo, não de suposição.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma.js';
import { uploadFileToR2 } from '../src/lib/r2.js';
import { brandProfileSchema, type BrandProfileData } from '../src/lib/brandProfile.js';
import { REFERENCE_ASSET_TAGS } from '../src/lib/designerBrain/referenceTags.js';

const SLUG = 'amanda-coelho';
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const filesDir = arg('--files');
const logosDir = arg('--logos');

// Paleta oficial (Cérebro de IA §11.4): serve só para NOMEAR cada logo pela cor medida.
const PALETA: Record<string, [number, number, number]> = {
  vinho: [0x41, 0x0c, 0x1c],
  vermelho: [0x8e, 0x24, 0x2e],
  'azul-gelo': [0xd8, 0xe9, 0xf3],
  creme: [0xfc, 0xf9, 0xeb],
};
const maisPerto = (r: number, g: number, b: number): string =>
  Object.entries(PALETA)
    .map(([nome, [pr, pg, pb]]) => [nome, Math.hypot(r - pr, g - pg, b - pb)] as const)
    .sort((a, b2) => a[1] - b2[1])[0]![0];

interface PlannedAsset {
  name: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  source: 'branding' | 'brandbook';
  tags: string[];
  label?: string; // para a ficha
  width: number;
  height: number;
}

async function medirLogo(file: string): Promise<{ tipo: 'wordmark' | 'monograma'; fundo: string; tinta: string; buffer: Buffer; width: number; height: number }> {
  const trimmed = await sharp(file).trim({ background: '#ffffff', threshold: 12 }).toBuffer({ resolveWithObject: true });
  const png = await sharp(trimmed.data).png().toBuffer();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]!) as [number, number, number];
  const bg = px(3, 3);
  const hist = new Map<string, number>();
  for (let y = 0; y < info.height; y += 3) {
    for (let x = 0; x < info.width; x += 3) {
      const p = px(x, y);
      if (Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 60) continue;
      const k = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  const ink = top ? (top[0].split(',').map((n) => parseInt(n, 10) * 16 + 8) as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
  return {
    tipo: info.width / info.height > 2.6 ? 'wordmark' : 'monograma',
    fundo: maisPerto(...bg),
    tinta: maisPerto(...ink),
    buffer: png,
    width: info.width,
    height: info.height,
  };
}

async function planejar(): Promise<PlannedAsset[]> {
  if (!filesDir || !logosDir) throw new Error('Informe --files e --logos.');
  const plano: PlannedAsset[] = [];

  for (let i = 1; i <= 14; i++) {
    const f = path.join(logosDir, `p${i}.png`);
    if (!fs.existsSync(f)) throw new Error(`Falta ${f}`);
    const m = await medirLogo(f);
    const nome = m.tipo === 'wordmark' ? 'AMANDACOELHO (wordmark)' : 'A—C (monograma)';
    const descricao = `${nome}, tinta ${m.tinta} sobre fundo ${m.fundo}`;
    plano.push({
      name: `Logo ${m.tipo} — ${m.tinta} sobre ${m.fundo}`,
      fileName: `amanda-logo-${m.tipo}-${m.tinta}-sobre-${m.fundo}.png`,
      buffer: m.buffer,
      mimeType: 'image/png',
      source: 'branding',
      tags: ['logo', 'LOGOTYPE'],
      label: `Logo ${descricao}`,
      width: m.width,
      height: m.height,
    });
  }

  const ref = async (arquivo: string, name: string, tag: string, mimeType: string): Promise<PlannedAsset> => {
    const buffer = fs.readFileSync(path.join(filesDir, arquivo));
    const meta = await sharp(buffer).metadata();
    return {
      name,
      fileName: arquivo.replace(/[^A-Za-z0-9._-]+/g, '-'),
      buffer,
      mimeType,
      source: 'brandbook',
      tags: [tag],
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  };
  plano.push(await ref('Moodboard Editorial da Marca AMANDACOELHO.png', 'Manual visual — Moodboard Editorial da Marca AMANDACOELHO', 'visual-manual', 'image/png'));
  plano.push(await ref('Moodboard para apresentações.png', 'Moodboard para apresentações', 'moodboard', 'image/png'));
  plano.push(await ref('Fonte em imagem.jpg', 'Fontes Queens e Aeonik (referência em imagem)', 'font-reference', 'image/jpeg'));
  plano.push(await ref('Paleta em imagem.jpg', 'Paleta oficial (referência em imagem)', 'palette-reference', 'image/jpeg'));
  return plano;
}

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, profile: { select: { id: true, data: true } } } });
  if (!brand) throw new Error(`Projeto "${SLUG}" não existe neste banco.`);
  const plano = await planejar();

  const existentes = await prisma.asset.findMany({ where: { brandId: brand.id, name: { in: plano.map((p) => p.name) } }, select: { name: true, url: true } });
  const jaTem = new Map(existentes.map((a) => [a.name, a.url]));
  console.log(`Projeto: ${brand.name}. ${plano.length} ativos planejados, ${jaTem.size} já estão na biblioteca.`);
  for (const p of plano) console.log(`  ${jaTem.has(p.name) ? 'já existe ' : 'enviar    '} ${p.name} (${p.width}x${p.height}, ${Math.round(p.buffer.length / 1024)} KB) [${p.tags.join(',')}]`);

  if (!apply) {
    console.log('Simulação: nada foi enviado nem gravado. Rode com --apply.');
    return;
  }

  const urls = new Map<string, string>(jaTem);
  for (const p of plano) {
    if (urls.has(p.name)) continue;
    const url = await uploadFileToR2(p.buffer, p.fileName, p.mimeType, `brands/${brand.id}`);
    await prisma.asset.create({
      data: { brandId: brand.id, name: p.name, url, fileType: p.mimeType, sizeBytes: p.buffer.length, width: p.width, height: p.height, source: p.source, tags: p.tags },
    });
    urls.set(p.name, url);
    console.log(`  enviado: ${p.name}`);
  }

  // Ficha: logo, manual visual e referência das fontes. O que a pessoa já preencheu é mantido.
  const atual = brandProfileSchema.parse(brand.profile?.data ?? {});
  const logoFiles = plano.filter((p) => p.label).map((p) => ({ url: urls.get(p.name)!, label: p.label! }));
  const manualUrl = urls.get('Manual visual — Moodboard Editorial da Marca AMANDACOELHO')!;
  const fonteUrl = urls.get('Fontes Queens e Aeonik (referência em imagem)')!;
  const nova: BrandProfileData = {
    ...atual,
    logo: {
      files: logoFiles,
      // Literal do documento da Gabi (§11.8). Nada além disso foi acrescentado.
      rules: atual.logo?.rules ?? 'Monograma A—C pode funcionar como assinatura discreta ou grafismo ampliado, sempre a partir do ativo oficial.',
    },
    visualManual: { ...(atual.visualManual ?? {}), imageUrl: manualUrl },
    typography: (atual.typography ?? []).map((t) => ({ ...t, referenceImageUrl: t.referenceImageUrl ?? fonteUrl })),
  };
  const valida = brandProfileSchema.parse(nova);
  await prisma.brandProfile.upsert({
    where: { brandId: brand.id },
    create: { brandId: brand.id, data: valida as Prisma.InputJsonValue },
    update: { data: valida as Prisma.InputJsonValue },
  });
  console.log(`Ficha atualizada: ${logoFiles.length} arquivos de logo, manual visual e referência de fonte. Tags de referência: ${REFERENCE_ASSET_TAGS.join(', ')}.`);
}

main()
  .catch((e) => {
    console.error('ERRO', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
