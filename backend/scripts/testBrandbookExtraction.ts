/**
 * Script de VERIFICAÇÃO MANUAL da extração de brandbook contra os PDFs REAIS da
 * Assinatura, direto no Gemini — sem passar por Prisma, R2 ou processBrandbookIngest.
 *
 * Existe porque a ingestão de verdade nunca foi testada contra o brandbook real desta
 * marca (ver seção 2(b) do diagnóstico, "Teste com o brandbook real da Assinatura"):
 * só foi lida a estrutura dos PDFs (PyMuPDF), nunca rodada a extração via IA. Este
 * script fecha essa lacuna, mas continua sendo você quem roda e lê o resultado — ele
 * NÃO faz asserção nenhuma, só imprime o que veio e compara (visualmente) com o
 * esperado.
 *
 * NÃO CHAMA: processBrandbookIngest, Prisma, R2. Só a função pura
 * `extractBrandInsights` + um cliente Gemini de verdade.
 *
 * Uso (PowerShell):
 *   $env:GEMINI_API_KEY = "sua-chave"
 *   pnpm exec tsx scripts/testBrandbookExtraction.ts "C:\caminho\ID Rebranding [Assinatura].pdf" "C:\caminho\[Assinatura] Plataforma de Marca.pdf"
 *
 * Uso (bash):
 *   GEMINI_API_KEY=sua-chave pnpm exec tsx scripts/testBrandbookExtraction.ts "/caminho/ID Rebranding [Assinatura].pdf" "/caminho/[Assinatura] Plataforma de Marca.pdf"
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { extractBrandInsights, type BrandbookExtractionPdfPart } from '../src/lib/brandbookExtraction.js';

// O que o diagnóstico (seção 2(b)) registrou como o esperado, lendo o brandbook real
// com PyMuPDF. Isto NÃO é um oráculo automático — é só a régua para você comparar.
const ESPERADO = {
  cores: ['#582731', '#8A0E2E', '#D41D59', '#233766', '#545BAE', '#E9BDA6'],
  fontes: ['Aileron', 'Monument Extended'],
  bracosNasGuidelines: ['Criatividade', 'Consultoria'],
};

async function main() {
  const [, , caminhoA, caminhoB] = process.argv;

  if (!caminhoA || !caminhoB) {
    console.error('Uso: pnpm exec tsx scripts/testBrandbookExtraction.ts <ID Rebranding.pdf> <Plataforma de Marca.pdf>');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY não está definida no ambiente. Carregue-a antes de rodar (ver o cabeçalho deste arquivo).');
    process.exit(1);
  }

  for (const caminho of [caminhoA, caminhoB]) {
    if (!fs.existsSync(caminho)) {
      console.error(`Arquivo não encontrado: ${caminho}`);
      process.exit(1);
    }
  }

  const ai = new GoogleGenAI({ apiKey });

  const parts: BrandbookExtractionPdfPart[] = [caminhoA, caminhoB].map((caminho) => ({
    kind: 'pdf',
    buffer: fs.readFileSync(path.resolve(caminho)),
    fileName: path.basename(caminho),
  }));

  console.log(`Lendo ${parts.length} PDF(s): ${parts.map((p) => `${p.fileName} (${(p.buffer.length / 1024 / 1024).toFixed(1)} MB)`).join(', ')}`);
  console.log('Chamando o Gemini (map-reduce: uma chamada por PDF)...\n');

  const inicio = Date.now();
  const resultado = await extractBrandInsights({
    client: ai,
    brandName: 'Assinatura',
    parts,
  });
  const duracaoMs = Date.now() - inicio;

  console.log('=== STATUS ===');
  console.log(resultado.status, resultado.reason ? `— ${resultado.reason}` : '');

  console.log('\n=== WARNINGS ===');
  if (resultado.warnings.length === 0) console.log('(nenhum)');
  resultado.warnings.forEach((w) => console.log(`- ${w}`));

  console.log('\n=== CORES EXTRAÍDAS ===');
  resultado.colors.forEach((c) => console.log(`- ${c.hex}${c.rgb ? ` rgb(${c.rgb})` : ''}${c.cmyk ? ` cmyk(${c.cmyk})` : ''}${c.pantone ? ` pantone ${c.pantone}` : ''}`));

  console.log('\n=== FONTES EXTRAÍDAS ===');
  resultado.primaryFonts.forEach((f) => console.log(`- ${f.family}${f.role ? ` (${f.role})` : ''}`));

  console.log('\n=== SVGS EXTRAÍDOS ===');
  if (resultado.svgs.length === 0) console.log('(nenhum — pode ser esperado: o prompt só vetoriza o que reconhece com segurança)');
  resultado.svgs.forEach((s) => console.log(`- ${s.name} (${s.classification})`));

  console.log(`\n=== TEMPO ===\n${duracaoMs}ms (${(duracaoMs / 1000).toFixed(1)}s)`);

  console.log('\n=== COMPARAÇÃO COM O ESPERADO (leitura humana, não é asserção automática) ===');
  const coresEncontradas = new Set(resultado.colors.map((c) => c.hex.toUpperCase()));
  console.log('Paleta oficial:');
  ESPERADO.cores.forEach((hex) => {
    console.log(`  ${hex}: ${coresEncontradas.has(hex.toUpperCase()) ? 'ENCONTRADA' : 'AUSENTE'}`);
  });

  const fontesEncontradas = resultado.primaryFonts.map((f) => f.family.toLowerCase());
  console.log('Fontes:');
  ESPERADO.fontes.forEach((f) => {
    const achou = fontesEncontradas.some((x) => x.includes(f.toLowerCase()));
    console.log(`  ${f}: ${achou ? 'ENCONTRADA' : 'AUSENTE'}`);
  });

  console.log('Braços de marca mencionados nas guidelines:');
  ESPERADO.bracosNasGuidelines.forEach((braco) => {
    const achou = resultado.guidelines.toLowerCase().includes(braco.toLowerCase());
    console.log(`  ${braco}: ${achou ? 'SIM' : 'NÃO'}`);
  });

  console.log('\n=== GUIDELINES COMPLETAS ===');
  console.log(resultado.guidelines || '(vazio)');
}

main().catch((err) => {
  console.error('Falha no script de verificação:', err);
  process.exit(1);
});
