// Testes de processBrandbookIngest (backend/src/lib/brandbookIngestion.ts) — a camada
// que PERSISTE (Prisma + R2). A extração via Gemini (extractBrandInsights) é mockada
// aqui: o que ela faz de verdade já está coberto em brandbookExtraction.test.ts. O que
// importa neste arquivo é: falha da IA não sobrescreve a marca, o SVG de dentro do ZIP
// sai sanitizado antes de ir ao R2, e o merge final de cores (teto + regex + IA) fecha
// certo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdmZip from 'adm-zip';
import { prismaMock } from './client';

vi.mock('../lib/r2', () => ({
  uploadFileToR2: vi.fn(async (_buf: Buffer, name: string) => `https://cdn.exemplo.com/${name}`),
  deleteFromR2: vi.fn(async () => true),
}));

// Preserva as funções de merge/dedupe REAIS (já testadas em brandbookExtraction.test.ts)
// e só troca a chamada à IA — é o ponto exato que este arquivo não quer exercitar de
// verdade (rede, custo, não-determinismo).
vi.mock('../lib/brandbookExtraction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/brandbookExtraction')>();
  return {
    ...actual,
    extractBrandInsights: vi.fn(),
  };
});

import { processBrandbookIngest } from '../lib/brandbookIngestion';
import { extractBrandInsights, MAX_BRAND_COLORS } from '../lib/brandbookExtraction';
import { uploadFileToR2 } from '../lib/r2';

const mockedExtract = extractBrandInsights as unknown as ReturnType<typeof vi.fn>;
const mockedUpload = uploadFileToR2 as unknown as ReturnType<typeof vi.fn>;

function buildFile(originalname: string, buffer: Buffer, mimetype: string): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
    stream: null as never,
    destination: '',
    filename: originalname,
    path: '',
  };
}

const brandRecord = {
  id: 'brand-1',
  slug: 'marca',
  name: 'Marca X',
  config: { colors: ['#111111'], primaryFonts: ['Inter'], guidelines: '', logoUrl: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.brand.findUnique.mockResolvedValue(brandRecord as unknown as never);
  prismaMock.folder.findFirst.mockResolvedValue({ id: 'folder-1' } as unknown as never);
  prismaMock.asset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `asset-${Math.random()}`, ...data }));
  prismaMock.brandConfig.upsert.mockResolvedValue({} as unknown as never);
  mockedExtract.mockResolvedValue({
    guidelines: '',
    colors: [],
    primaryFonts: [],
    svgs: [],
    warnings: [],
    status: 'ok',
  });
});

describe('processBrandbookIngest — falha da IA não sobrescreve a marca (item f)', () => {
  it('status failed: NÃO chama brandConfig.upsert e devolve os valores ATUAIS da marca', async () => {
    mockedExtract.mockResolvedValue({
      guidelines: '',
      colors: [],
      primaryFonts: [],
      svgs: [],
      warnings: ['Falha ao consultar a IA para brandbook.pdf: 503 overloaded'],
      status: 'failed',
      reason: 'A conta do Gemini está sem créditos',
    });

    const result = await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('brandbook.pdf', Buffer.from('%PDF-1.4 conteúdo'), 'application/pdf')],
    });

    expect(prismaMock.brandConfig.upsert).not.toHaveBeenCalled();
    expect(result.extraction.status).toBe('failed');
    expect(result.extraction.reason).toBe('A conta do Gemini está sem créditos');
    expect(result.colors).toEqual(brandRecord.config.colors);
    expect(result.primaryFonts).toEqual(brandRecord.config.primaryFonts);
    expect(result.guidelines).toEqual(brandRecord.config.guidelines);
  });

  it('status ok: chama brandConfig.upsert normalmente', async () => {
    mockedExtract.mockResolvedValue({
      guidelines: 'Tom acolhedor.',
      colors: [{ hex: '#582731' }],
      primaryFonts: [{ family: 'Aileron' }],
      svgs: [],
      warnings: [],
      status: 'ok',
    });

    const result = await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('brandbook.pdf', Buffer.from('%PDF-1.4'), 'application/pdf')],
    });

    expect(prismaMock.brandConfig.upsert).toHaveBeenCalled();
    expect(result.extraction.status).toBe('ok');
    expect(result.colors).toContain('#582731');
  });
});

describe('processBrandbookIngest — SVG malicioso dentro do ZIP sai sanitizado', () => {
  it('script embutido no SVG do zip não sobrevive ao upload para o R2', async () => {
    const zip = new AdmZip();
    const malicioso = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    zip.addFile('grafismo.svg', Buffer.from(malicioso, 'utf-8'));

    await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('pacote.zip', zip.toBuffer(), 'application/zip')],
    });

    const svgUploadCall = mockedUpload.mock.calls.find(([, name]) => name === 'grafismo.svg');
    expect(svgUploadCall, 'o SVG do zip deveria ter sido enviado ao R2').toBeTruthy();

    const [bufferEnviado] = svgUploadCall!;
    const svgTexto = Buffer.isBuffer(bufferEnviado) ? bufferEnviado.toString('utf-8') : String(bufferEnviado);
    expect(svgTexto.toLowerCase()).not.toContain('<script');
    expect(svgTexto).toContain('<svg'); // continua sendo um SVG válido, só sem o script
  });

  it('SVG reconstruído pela IA (ai-reconstructed) também é sanitizado antes do upload', async () => {
    mockedExtract.mockResolvedValue({
      guidelines: '',
      colors: [],
      primaryFonts: [],
      svgs: [{
        name: 'vetor-ia.svg',
        classification: 'GRAPHIC_ELEMENT',
        svgCode: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5"/></svg>',
      }],
      warnings: [],
      status: 'ok',
    });

    await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('brandbook.pdf', Buffer.from('%PDF-1.4'), 'application/pdf')],
    });

    const svgUploadCall = mockedUpload.mock.calls.find(([, name]) => name === 'vetor-ia.svg');
    expect(svgUploadCall).toBeTruthy();
    const [bufferEnviado] = svgUploadCall!;
    const svgTexto = Buffer.isBuffer(bufferEnviado) ? bufferEnviado.toString('utf-8') : String(bufferEnviado);
    expect(svgTexto.toLowerCase()).not.toContain('onload');
  });
});

describe('processBrandbookIngest — merge final de cores (teto 24 + regex como complemento)', () => {
  it('cores da IA entram, regex do HTML complementa, e o teto de 24 avisa quando estoura', async () => {
    const levels = [0, 51, 102, 153, 204, 255];
    const manyHex: string[] = [];
    for (const r of levels) {
      for (const g of levels) {
        if (manyHex.length >= 25) break;
        manyHex.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}00`);
      }
    }

    mockedExtract.mockResolvedValue({
      guidelines: 'Tom direto.',
      colors: manyHex.map((hex) => ({ hex })),
      primaryFonts: [{ family: 'Aileron', role: 'texto corrido' }],
      svgs: [],
      warnings: [],
      status: 'ok',
    });

    const htmlComCorExtra = Buffer.from('<html><body style="color:#abcdef">oi</body></html>', 'utf-8');

    const result = await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('pagina.html', htmlComCorExtra, 'text/html')],
    });

    expect(result.colors).toHaveLength(MAX_BRAND_COLORS);
    expect(result.extraction.warnings.some((w) => w.includes(`teto de ${MAX_BRAND_COLORS}`))).toBe(true);
    expect(result.primaryFonts).toContain('Aileron');
  });

  it('cores já cadastradas na marca têm prioridade sobre as da IA em caso de quase-duplicata', async () => {
    mockedExtract.mockResolvedValue({
      guidelines: '',
      // quase-duplicata da cor já cadastrada (#111111) — deve perder para a existente
      colors: [{ hex: '#121212' }, { hex: '#582731' }],
      primaryFonts: [],
      svgs: [],
      warnings: [],
      status: 'ok',
    });

    const result = await processBrandbookIngest({
      brandSlug: 'marca',
      files: [buildFile('brandbook.pdf', Buffer.from('%PDF-1.4'), 'application/pdf')],
    });

    expect(result.colors).toContain('#111111');
    expect(result.colors).not.toContain('#121212');
    expect(result.colors).toContain('#582731');
  });
});

describe('processBrandbookIngest — sem teto global de 6 partes para a extração (item c)', () => {
  it('7 imagens soltas + 1 PDF viram 8 partes passadas para extractBrandInsights', async () => {
    const files = [
      ...Array.from({ length: 7 }, (_, i) => buildFile(`foto-${i}.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')),
      buildFile('doc.pdf', Buffer.from('%PDF-1.4'), 'application/pdf'),
    ];

    await processBrandbookIngest({ brandSlug: 'marca', files });

    expect(mockedExtract).toHaveBeenCalledTimes(1);
    const callArg = mockedExtract.mock.calls[0]![0] as { parts: unknown[] };
    expect(callArg.parts).toHaveLength(8);
  });
});
