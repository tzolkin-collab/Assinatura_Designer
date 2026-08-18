import sharp from 'sharp';
import { uploadFileToR2 } from './r2.js';
import { logger } from './logger.js';

/**
 * Logo exportado de Canva, Word ou PowerPoint costuma chegar como PNG/JPEG SEM
 * canal alfa: a arte é escura sobre um retângulo branco chapado. Em slide de
 * fundo claro ninguém percebe; em fundo escuro vira uma CAIXA BRANCA, que é
 * pior do que não ter logo. Foi exatamente o que aconteceu com a marca
 * assinatura — o logo aparecia como quadrado branco em todos os slides.
 *
 * Para arte monocromática sobre branco existe uma conversão EXATA: cada pixel
 * cinza já é a opacidade que ele deveria ter, então `alfa = 255 - luminância`.
 * Isso preserva o antisserrilhado integralmente. Recorte por limiar de cor
 * (o `colorkey` do ffmpeg, por exemplo) não preserva: os pixels cinza da borda
 * do traço ficam sem resposta e sobra franja serrilhada.
 *
 * O RISCO desta conversão é aplicá-la onde não cabe — num logo colorido, ou
 * num logo claro sobre fundo escuro, ela destrói o arquivo. Por isso a detecção
 * é conservadora e o padrão é NÃO MEXER: só converte quando os quatro testes
 * abaixo passam, e qualquer falha devolve a URL original.
 */

/** Proporção mínima de pixels claros na borda para aceitar "fundo branco". */
const MIN_BORDA_CLARA = 0.9;
/** Proporção máxima de pixels com saturação perceptível para aceitar "monocromático". */
const MAX_PIXELS_COLORIDOS = 0.02;
/** Acima disto um pixel conta como colorido (distância entre canais). */
const LIMIAR_SATURACAO = 18;
/** Acima disto um pixel conta como claro. */
const LIMIAR_CLARO = 245;

export interface DiagnosticoLogo {
  aplicavel: boolean;
  motivo: string;
  temAlfa?: boolean;
  fracaoColorida?: number;
  fracaoBordaClara?: number;
}

/**
 * Decide se vale converter, sem efeitos colaterais. Exportado para teste e para
 * quem quiser só inspecionar.
 */
export async function diagnosticarLogo(buffer: Buffer): Promise<DiagnosticoLogo> {
  const meta = await sharp(buffer).metadata();

  if (meta.hasAlpha) return { aplicavel: false, motivo: 'já tem canal alfa', temAlfa: true };
  if (!meta.width || !meta.height) return { aplicavel: false, motivo: 'dimensões desconhecidas' };

  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let coloridos = 0;
  const totalPixels = width * height;
  for (let p = 0; p < data.length; p += channels) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > LIMIAR_SATURACAO) coloridos++;
  }
  const fracaoColorida = coloridos / totalPixels;
  if (fracaoColorida > MAX_PIXELS_COLORIDOS) {
    return { aplicavel: false, motivo: 'logo colorido — converter destruiria as cores', fracaoColorida };
  }

  // A borda é o que diz se o fundo é claro. Olhar a imagem inteira enganaria:
  // um logo com muita área escura teria média baixa mesmo com fundo branco.
  let bordaClara = 0, bordaTotal = 0;
  const claro = (x: number, y: number) => {
    const p = (y * width + x) * channels;
    bordaTotal++;
    if (data[p]! > LIMIAR_CLARO && data[p + 1]! > LIMIAR_CLARO && data[p + 2]! > LIMIAR_CLARO) bordaClara++;
  };
  for (let x = 0; x < width; x++) { claro(x, 0); claro(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { claro(0, y); claro(width - 1, y); }

  const fracaoBordaClara = bordaClara / bordaTotal;
  if (fracaoBordaClara < MIN_BORDA_CLARA) {
    return { aplicavel: false, motivo: 'fundo não é branco', fracaoColorida, fracaoBordaClara };
  }

  return { aplicavel: true, motivo: 'arte monocromática sobre fundo branco', fracaoColorida, fracaoBordaClara };
}

/** Converte luminância em alfa. Só chame depois de `diagnosticarLogo`. */
export async function aplicarAlfaPorLuminancia(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    rgba[j] = 0;
    rgba[j + 1] = 0;
    rgba[j + 2] = 0;
    rgba[j + 3] = 255 - data[i]!;
  }
  return await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Entrada única para quem grava logo. Devolve a URL a usar: a nova, quando a
 * conversão valeu; a original, em qualquer outro caso — inclusive erro.
 *
 * Nunca lança, e nunca apaga o arquivo antigo: o original continua no R2, então
 * a troca é reversível apontando o logoUrl de volta.
 */
export async function normalizarLogoParaFundoEscuro(logoUrl: string): Promise<string> {
  try {
    if (/\.svg($|\?)/i.test(logoUrl)) return logoUrl;

    const res = await fetch(logoUrl);
    if (!res.ok) {
      logger.warn('Logo não pôde ser baixado para normalização', { logoUrl, status: res.status });
      return logoUrl;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const d = await diagnosticarLogo(buffer);
    if (!d.aplicavel) {
      logger.info('Logo mantido como está', { logoUrl, motivo: d.motivo });
      return logoUrl;
    }

    const png = await aplicarAlfaPorLuminancia(buffer);
    const nome = (logoUrl.split('/').pop() ?? 'logo').replace(/\.[a-z0-9]+$/i, '') + '-transparente.png';
    const novaUrl = await uploadFileToR2(png, nome, 'image/png', 'logos');

    logger.info('Logo opaco convertido para transparente', {
      logoUrl, novaUrl, fracaoBordaClara: d.fracaoBordaClara,
    });
    return novaUrl;
  } catch (error) {
    // Logo é acessório do fluxo de marca: falhar aqui não pode impedir alguém
    // de salvar a configuração.
    logger.warn('Normalização de logo falhou (fail-open, mantém o original)', {
      logoUrl, error: error instanceof Error ? error.message : String(error),
    });
    return logoUrl;
  }
}
