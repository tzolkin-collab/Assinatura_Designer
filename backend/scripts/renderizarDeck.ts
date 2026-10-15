// Renderiza os slides de decks ja gerados em PNG (com as fontes proprias do deck embutidas, como no app).
// Uso: OUT_DIR=<pasta> POSTS='{"rotulo":"<prefixo-do-id>"}' pnpm exec tsx scripts/renderizarDeck.ts
import 'dotenv/config';
import fs from 'node:fs';
import prisma from '../src/lib/prisma.js';
import { buildSlideDocument } from '../src/lib/htmlDesign.js';
import { renderHtmlToBase64 } from '../src/lib/htmlRaster.js';
import { parseFontRefs, toDataUriFaces } from '../src/lib/customFonts.js';
const OUT = process.env.OUT_DIR!;
const map: Record<string,string> = JSON.parse(process.env.POSTS!);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [label, prefix] of Object.entries(map)) {
    const post = await prisma.post.findFirst({ where: { id: { startsWith: prefix } } });
    if (!post) { console.log('sem post', prefix); continue; }
    const c: any = post.content;
    const rows = await prisma.slide.findMany({ where: { postId: post.id }, orderBy: { position: 'asc' } });
    const faces = await toDataUriFaces(parseFontRefs(c?.fontFaces));
    console.log('  fontFaces próprias:', faces.map((f) => f.family).join(', ') || 'nenhuma');
    console.log(label, post.id, 'fonts=' + JSON.stringify(c?.fonts), 'slides=' + rows.length);
    for (const r of rows) {
      const cj: any = r.contentJson;
      const html: string = cj.html ?? '';
      const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
      const names: string[] = [];
      for (const u of imgs) { const a = await prisma.asset.findFirst({ where: { url: u }, select: { name: true, source: true } }); names.push(a ? `${a.name}[${a.source}]` : u.slice(0, 50)); }
      console.log(`  s${r.position + 1} imgs=${names.join(' | ') || '-'} slots=${(html.match(/data-photo-slot=/g) ?? []).length}`);
      const doc = buildSlideDocument({ html: cj.html, css: cj.css }, c.fonts ?? ['Inter'], c.width, c.height, faces);
      fs.writeFileSync(`${OUT}/${label}-slide${r.position + 1}.png`, Buffer.from(await renderHtmlToBase64(doc, { width: c.width, height: c.height, maxDim: 1280 }), 'base64'));
    }
  }
  await prisma.$disconnect(); process.exit(0);
})();
