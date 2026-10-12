// TEMPORÁRIO: mede o corte centralizado de hoje contra o enquadramento pelo assunto. Não commitar.
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config.js';
import prisma from '../src/lib/prisma.js';
import { detectSubjectFocus, framePosition, visibleFraction, type Box, type SubjectFocus } from '../src/lib/photoFocus.js';

const OUT = process.argv[2]!;
const MOOD = process.argv[3]!;

// Recortes do moodboard editorial (coordenadas na imagem exibida, largura 1122).
const CROPS: Array<{ name: string; x: number; y: number; w: number; h: number }> = [
  { name: 'retrato-close', x: 640, y: 0, w: 225, h: 365 },
  { name: 'retrato-capa', x: 32, y: 897, w: 324, h: 416 },
  { name: 'figura-pequena', x: 714, y: 1132, w: 202, h: 182 },
  { name: 'blazer-sem-rosto', x: 362, y: 1132, w: 208, h: 180 },
];

// Formatos de espaço (largura/altura) que a geração real usa.
const SLOTS: Array<{ name: string; aspect: number }> = [
  { name: 'retrato 3:4', aspect: 3 / 4 },
  { name: 'alto 9:16', aspect: 9 / 16 },
  { name: 'quadrado', aspect: 1 },
  { name: 'paisagem 16:9', aspect: 16 / 9 },
  { name: 'faixa 3:1', aspect: 3 },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

async function overlay(buf: Buffer, f: SubjectFocus, file: string) {
  const m = await sharp(buf).metadata();
  const W = m.width!, H = m.height!;
  const rect = (b: Box, color: string) =>
    `<rect x="${b.x0 * W}" y="${b.y0 * H}" width="${(b.x1 - b.x0) * W}" height="${(b.y1 - b.y0) * H}" fill="none" stroke="${color}" stroke-width="${Math.max(3, W / 120)}"/>`;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rect(f.subject, '#00c853')}${f.face ? rect(f.face, '#ff1744') : ''}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
}

(async () => {
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const photos: Array<{ name: string; buf: Buffer }> = [];
  const mood = sharp(MOOD);
  const mm = await mood.metadata();
  const k = mm.width! / 1122;
  console.log(`moodboard ${mm.width}x${mm.height} (escala ${k.toFixed(2)})`);
  for (const c of CROPS) {
    photos.push({
      name: c.name,
      buf: await sharp(MOOD).extract({ left: Math.round(c.x * k), top: Math.round(c.y * k), width: Math.round(c.w * k), height: Math.round(c.h * k) }).png().toBuffer(),
    });
  }
  const ai = await prisma.asset.findMany({ where: { brand: { slug: 'amanda-coelho' }, source: 'ai-generated' }, select: { name: true, url: true }, take: 2 });
  for (const [i, a] of ai.entries()) {
    const r = await fetch(a.url);
    photos.push({ name: `ia-${i + 1}-${a.name.includes('cena') ? 'cena' : 'retrato'}`, buf: Buffer.from(await r.arrayBuffer()) });
  }

  const rows: string[] = [];
  let tot = { centerFace: 0, autoFace: 0, centerSub: 0, autoSub: 0, faceCases: 0, cases: 0, cutCenter: 0, cutAuto: 0 };
  for (const p of photos) {
    const meta = await sharp(p.buf).metadata();
    const aspect = meta.width! / meta.height!;
    const t0 = Date.now();
    const focus = await detectSubjectFocus({ client: client as never, base64: p.buf.toString('base64'), mimeType: 'image/png', model: config.models.fast });
    const ms = Date.now() - t0;
    fs.writeFileSync(`${OUT}/foto-${p.name}.png`, p.buf);
    if (!focus) { console.log(`${p.name} ${meta.width}x${meta.height}: DETECÇÃO FALHOU (${ms} ms)`); continue; }
    await overlay(p.buf, focus, `${OUT}/caixas-${p.name}.png`);
    console.log(`\n${p.name} ${meta.width}x${meta.height} (${ms} ms) assunto=${JSON.stringify(focus.subject, (_, v) => (typeof v === 'number' ? +v.toFixed(2) : v))} rosto=${focus.face ? 'sim' : 'não'}`);
    for (const s of SLOTS) {
      const center = { x: 50, y: 50 };
      const auto = framePosition(focus, aspect, s.aspect);
      const sub = (pos: typeof center) => visibleFraction(focus.subject, aspect, s.aspect, pos);
      const fc = focus.face ? visibleFraction(focus.face, aspect, s.aspect, center) : null;
      const fa = focus.face ? visibleFraction(focus.face, aspect, s.aspect, auto) : null;
      const crops = Math.abs(aspect - s.aspect) > 0.02;
      tot.cases++;
      if (crops) {
        tot.centerSub += sub(center); tot.autoSub += sub(auto);
        if (focus.face) { tot.faceCases++; tot.centerFace += fc!; tot.autoFace += fa!; if (fc! < 0.98) tot.cutCenter++; if (fa! < 0.98) tot.cutAuto++; }
      }
      rows.push(`${p.name.padEnd(18)} ${s.name.padEnd(14)} pos=${auto.x},${auto.y}`.padEnd(54) + `rosto visível: centro ${fc === null ? '  - ' : pct(fc).padStart(4)} → auto ${fa === null ? '  - ' : pct(fa).padStart(4)} | assunto: centro ${pct(sub(center)).padStart(4)} → auto ${pct(sub(auto)).padStart(4)}`);
    }
  }
  console.log('\n' + rows.join('\n'));
  console.log(`\nRESUMO (só combinações em que a foto é cortada): rostos cortados com centro=${tot.cutCenter} de ${tot.faceCases}; com auto=${tot.cutAuto} de ${tot.faceCases}`);
  console.log(`rosto visível médio: centro ${pct(tot.centerFace / (tot.faceCases || 1))} → auto ${pct(tot.autoFace / (tot.faceCases || 1))}`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
