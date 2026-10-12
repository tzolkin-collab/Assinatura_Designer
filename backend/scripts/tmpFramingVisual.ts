// TEMPORÁRIO: antes/depois do enquadramento num slide real. Não commitar.
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';
import prisma from '../src/lib/prisma.js';
import { setPhotoInSlot, listPhotoSlots } from '../src/lib/photoSlot.js';
import { buildSlideDocument } from '../src/lib/htmlDesign.js';
import { renderHtmlToBase64, closeBrowser } from '../src/lib/htmlRaster.js';
import { analyzePhoto, frameFromAnalysis, measureSlotAspect } from '../src/lib/photoFraming.js';

const POST = process.argv[2]!;
const OUT = process.argv[3]!;
const PHOTOS = process.argv.slice(4); // arquivos locais

(async () => {
  const post = await prisma.post.findUnique({ where: { id: POST } });
  const content: any = post!.content;
  const rows = await prisma.slide.findMany({ where: { postId: POST }, orderBy: { position: 'asc' } });
  const W = content.width, H = content.height;

  for (const photoPath of PHOTOS) {
    const buf = fs.readFileSync(photoPath);
    const name = photoPath.split(/[\\/]/).pop()!.replace(/\.\w+$/, '');
    const dataUrl = `data:image/png;base64,${(await sharp(buf).resize({ width: 1400, withoutEnlargement: true }).png().toBuffer()).toString('base64')}`;
    const analysis = await analyzePhoto(`local:${name}`, { fetchImage: async () => buf });
    for (const r of rows) {
      const cj: any = r.contentJson;
      for (const slotInfo of listPhotoSlots(cj.html)) {
        const doc = buildSlideDocument({ html: cj.html, css: cj.css }, content.fonts ?? ['Inter'], W, H);
        const aspect = await measureSlotAspect(doc, { width: W, height: H }, slotInfo.slot);
        const auto = frameFromAnalysis(analysis, aspect);
        const tag = `${name}-s${r.position + 1}-slot${slotInfo.slot}`;
        console.log(`${tag}: espaço ${aspect?.toFixed(2)} foto ${analysis?.aspect.toFixed(2)} → auto ${auto ? `${auto.position.x},${auto.position.y} rosto visível ${auto.faceVisible}` : 'sem auto'}`);
        for (const [label, pos] of [['centro', { x: 50, y: 50 }], ['auto', auto?.position ?? { x: 50, y: 50 }]] as const) {
          const html = setPhotoInSlot(cj.html, slotInfo.slot, { url: dataUrl, position: pos });
          const d = buildSlideDocument({ html, css: cj.css }, content.fonts ?? ['Inter'], W, H);
          fs.writeFileSync(`${OUT}/${tag}-${label}.png`, Buffer.from(await renderHtmlToBase64(d, { width: W, height: H, maxDim: 1280 }), 'base64'));
        }
        break; // um espaço por slide basta
      }
    }
  }
  await closeBrowser().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
