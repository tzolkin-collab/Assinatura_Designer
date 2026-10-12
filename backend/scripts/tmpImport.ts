// TEMPORÁRIO — roda a importação da ficha de verdade (Gemini real) num manual. Não commitar.
import 'dotenv/config';
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config.js';
import { extractProfileFromManual } from '../src/lib/profileExtraction.js';
import { profileCompleteness } from '../src/lib/brandProfile.js';

const [mode, dir] = process.argv.slice(2);

(async () => {
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const md = fs.readFileSync(`${dir}/manual-assinatura.md`, 'utf-8');
  const t0 = Date.now();
  const result =
    mode === 'texto'
      ? await extractProfileFromManual({ client, brandName: 'Assinatura', parts: [], sourceText: md })
      : await extractProfileFromManual({
          client,
          brandName: 'Assinatura',
          parts: [{ kind: 'pdf', buffer: fs.readFileSync(`${dir}/manual-assinatura.pdf`), fileName: 'manual-assinatura.pdf' }],
        });
  const c = profileCompleteness(result.draft);
  console.log(JSON.stringify({ modo: mode, segundos: Math.round((Date.now() - t0) / 1000), status: result.status, reason: result.reason, quotesChecked: result.quotesChecked, completude: c.percent, pronta: c.ready, notFound: result.notFound, warnings: result.warnings }, null, 2));
  fs.writeFileSync(`${dir}/resultado-${mode}.json`, JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('ERRO', e.message);
  process.exit(1);
});
