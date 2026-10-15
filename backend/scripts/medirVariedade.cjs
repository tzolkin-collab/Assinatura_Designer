// Mede a variedade de composicao entre os slides de cada deck (mapa de ocupacao 16x9, distancia media entre
// pares: 0 = slides iguais, 1 = totalmente diferentes). METRICA GROSSEIRA: so ve onde ha conteudo contra o
// fundo, nao tipografia nem ilustracao. Uso: node scripts/medirVariedade.cjs <pasta com *-slideN.png>
const sharp = require('sharp'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const GW = 16, GH = 9;
async function feat(file) {
  const { data } = await sharp(file).resize(GW, GH, { fit: 'fill', kernel: 'mitchell' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = []; for (let i = 0; i < GW * GH; i++) px.push([data[i*3], data[i*3+1], data[i*3+2]]);
  const lum = px.map(p => 0.299*p[0] + 0.587*p[1] + 0.114*p[2]);
  const s = [...lum].sort((a,b)=>a-b); const med = s[Math.floor(s.length/2)];
  const fg = lum.map(l => Math.abs(l - med) > 35 ? 1 : 0);
  const q = [0,1,2].map(k => Math.floor(px.map(p=>p[k]).sort((a,b)=>a-b)[Math.floor(px.length/2)] / 64));
  return { fg, bg: q.join('') };
}
function pairMean(fs) { let n=0,s=0; for (let i=0;i<fs.length;i++) for (let j=i+1;j<fs.length;j++){ let h=0; for (let k=0;k<fs[i].fg.length;k++) if (fs[i].fg[k]!==fs[j].fg[k]) h++; s+=h/fs[i].fg.length; n++; } return n ? +(s/n).toFixed(3) : null; }
(async () => {
  const groups = {};
  for (const f of fs.readdirSync(dir).filter(f => /-slide\d+\.png$/.test(f))) { const g = f.replace(/-slide\d+\.png$/, ''); (groups[g] ||= []).push(path.join(dir, f)); }
  const all = [];
  for (const [g, files] of Object.entries(groups)) {
    files.sort(); const ft = []; for (const f of files) ft.push(await feat(f)); all.push(...ft);
    console.log(g.padEnd(22), 'n=' + ft.length, 'variedade=' + pairMean(ft), 'fundos=' + new Set(ft.map(x=>x.bg)).size);
  }
  console.log('TOTAL'.padEnd(22), 'n=' + all.length, 'variedade=' + pairMean(all));
})();
