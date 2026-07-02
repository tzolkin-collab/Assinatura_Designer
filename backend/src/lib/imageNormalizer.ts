import sharp from 'sharp';

// ── Tipos aceitos pelo sistema ──────────────────────────────────────────────

export type InputMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/jpg'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/heic'
  | 'image/heif'
  | 'image/gif'
  | 'image/avif';

export type OutputMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

// ── Regras de conversão ─────────────────────────────────────────────────────
// Edite aqui para controlar o que entra e o que sai.

interface ConversionRule {
  outputMimeType: OutputMimeType;
  outputExtension: string;
  sanitize?: boolean;    // remove scripts/event handlers antes de processar
  aiReady?: boolean;     // pode ser enviado ao Gemini sem conversão adicional
}

export const CONVERSION_RULES: Record<InputMimeType, ConversionRule> = {
  'image/png':     { outputMimeType: 'image/png',  outputExtension: 'png',  aiReady: true  },
  'image/jpeg':    { outputMimeType: 'image/jpeg', outputExtension: 'jpg',  aiReady: true  },
  'image/jpg':     { outputMimeType: 'image/jpeg', outputExtension: 'jpg',  aiReady: true  },
  'image/webp':    { outputMimeType: 'image/webp', outputExtension: 'webp', aiReady: true  },
  'image/svg+xml': { outputMimeType: 'image/png',  outputExtension: 'png',  sanitize: true, aiReady: false },
  'image/heic':    { outputMimeType: 'image/jpeg', outputExtension: 'jpg',  aiReady: false },
  'image/heif':    { outputMimeType: 'image/jpeg', outputExtension: 'jpg',  aiReady: false },
  'image/gif':     { outputMimeType: 'image/png',  outputExtension: 'png',  aiReady: false },
  'image/avif':    { outputMimeType: 'image/jpeg', outputExtension: 'jpg',  aiReady: false },
};

// Extensões de arquivo aceitas (para o accept do file input e validação)
export const ACCEPTED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp',
  '.svg',
  '.heic', '.heif',
  '.gif',
  '.avif',
];

export const ACCEPTED_MIME_TYPES = Object.keys(CONVERSION_RULES) as InputMimeType[];

const MAX_INPUT_BYTES  = 10 * 1024 * 1024; // 10 MB
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION    = 2048; // px — redimensiona se passar disso

// ── Resultado da normalização ───────────────────────────────────────────────

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: OutputMimeType;
  extension: string;
  originalMimeType: string;
  wasConverted: boolean;
  width: number;
  height: number;
  sizeBytes: number;
}

// ── Sanitização de SVG ──────────────────────────────────────────────────────
// Remove vetores de XSS antes de rasterizar.

function sanitizeSvg(buffer: Buffer): Buffer {
  let svg = buffer.toString('utf-8');
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  svg = svg.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  svg = svg.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  svg = svg.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href="#"');
  return Buffer.from(svg, 'utf-8');
}

// ── Função principal ────────────────────────────────────────────────────────

export async function normalizeImage(
  buffer: Buffer,
  inputMimeType: string,
  options: { maxDimension?: number } = {}
): Promise<NormalizedImage> {
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error(`Arquivo muito grande: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Máximo: ${MAX_INPUT_BYTES / 1024 / 1024}MB`);
  }

  const mime = inputMimeType.toLowerCase() as InputMimeType;
  const rule = CONVERSION_RULES[mime];

  if (!rule) {
    throw new Error(
      `Tipo não suportado: ${inputMimeType}. Aceitos: ${ACCEPTED_MIME_TYPES.join(', ')}`
    );
  }

  let processBuffer = buffer;
  if (rule.sanitize) processBuffer = sanitizeSvg(buffer);

  const maxDim = options.maxDimension ?? MAX_DIMENSION;

  let pipeline = sharp(processBuffer, { failOnError: false })
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });

  if (rule.outputMimeType === 'image/png') {
    pipeline = pipeline.png({ compressionLevel: 8 });
  }
  
  if (rule.outputMimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 90 });
  }
  
  if (rule.outputMimeType !== 'image/png' && rule.outputMimeType !== 'image/jpeg') {
    pipeline = pipeline.webp({ quality: 90 });
  }

  const { data: output, info } = await pipeline.toBuffer({ resolveWithObject: true });

  if (output.length > MAX_OUTPUT_BYTES) {
    throw new Error(
      `Imagem pós-processamento muito grande: ${(output.length / 1024 / 1024).toFixed(1)}MB`
    );
  }

  return {
    buffer: output,
    mimeType: rule.outputMimeType,
    extension: rule.outputExtension,
    originalMimeType: mime,
    wasConverted: mime !== rule.outputMimeType,
    width: info.width,
    height: info.height,
    sizeBytes: output.length,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isSupportedMimeType(mimeType: string): mimeType is InputMimeType {
  return mimeType.toLowerCase() in CONVERSION_RULES;
}

/** Retorna o mimeType de saída que o Gemini receberá após normalização */
export function getAiMimeType(inputMimeType: string): OutputMimeType {
  const rule = CONVERSION_RULES[inputMimeType.toLowerCase() as InputMimeType];
  return rule?.outputMimeType ?? 'image/png';
}
