/**
 * `BrandConfig.guidelines` tem DOIS escritores que não combinaram formato:
 *
 *  - a página de Branding grava um OBJETO JSON serializado
 *    ({ name, history, website, instagram, style, restrictions });
 *  - a ingestão de brandbook concatenava TEXTO no fim do que já existia
 *    (`${atual}\n\n### Atualização do Brandbook:\n${novo}`).
 *
 * Quando a ingestão rodava depois de um save da página, o resultado era
 * "JSON + texto solto" — que não é JSON. Aí a página caía no catch, jogava a
 * string inteira dentro de `history` e resetava `name` para o placeholder
 * "Nome da Marca". Todas as marcas que passaram por ingestão ficaram assim,
 * com o conteúdo real aninhado e o nome perdido.
 *
 * Este módulo é o formato único: entende as duas formas de entrada e sempre
 * devolve algo que a página consegue reabrir sem perder campo.
 */

export interface GuidelinesEstruturado {
  name: string;
  history: string;
  website: string;
  instagram: string;
  style: string;
  restrictions: string;
}

/** O mesmo default do formulário — precisa bater, senão o merge reintroduz placeholder. */
const VAZIO: GuidelinesEstruturado = {
  name: '',
  history: '',
  website: '',
  instagram: '',
  style: '',
  restrictions: '',
};

const PLACEHOLDERS = new Set([
  'Nome da Marca',
  'Resumo sobre o que a marca faz e sua essência',
  'https://',
  '@',
  'Minimalista e limpo',
  'Sem emojis exagerados',
]);

const MARCADOR = '### Atualização do Brandbook:';

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Lê `guidelines` em qualquer uma das formas já gravadas no banco e devolve a
 * estrutura, mais o texto que não coube em campo nenhum.
 *
 * Desfaz o aninhamento: quando `history` contém um JSON do mesmo formato — o
 * estrago descrito acima —, o conteúdo de dentro vence, porque é o original.
 */
export function lerGuidelines(bruto: string | null | undefined): {
  estrutura: GuidelinesEstruturado;
  textoSolto: string;
} {
  const s = (bruto ?? '').trim();
  if (!s) return { estrutura: { ...VAZIO }, textoSolto: '' };

  // Caso 1: JSON puro.
  try {
    const p: unknown = JSON.parse(s);
    if (ehObjeto(p)) {
      const estrutura = { ...VAZIO };
      let textoSolto = '';
      for (const chave of Object.keys(VAZIO) as Array<keyof GuidelinesEstruturado>) {
        const v = p[chave];
        if (typeof v === 'string' && !PLACEHOLDERS.has(v.trim())) estrutura[chave] = v;
      }
      // Desaninha: `history` guardando outro guidelines inteiro.
      if (estrutura.history.trim().startsWith('{')) {
        const dentro = lerGuidelines(estrutura.history);
        for (const chave of Object.keys(VAZIO) as Array<keyof GuidelinesEstruturado>) {
          if (dentro.estrutura[chave]) estrutura[chave] = dentro.estrutura[chave];
        }
        textoSolto = dentro.textoSolto;
      }
      return { estrutura, textoSolto };
    }
  } catch {
    // não era JSON — segue para o caso 2
  }

  // Caso 2: JSON seguido de texto concatenado pela ingestão antiga.
  const corte = s.indexOf(MARCADOR);
  if (corte > 0) {
    const antes = s.slice(0, corte).trim();
    const depois = s.slice(corte + MARCADOR.length).trim();
    if (antes.startsWith('{')) {
      const parcial = lerGuidelines(antes);
      return {
        estrutura: parcial.estrutura,
        textoSolto: [parcial.textoSolto, depois].filter(Boolean).join('\n\n'),
      };
    }
    return { estrutura: { ...VAZIO }, textoSolto: [antes, depois].filter(Boolean).join('\n\n') };
  }

  // Caso 3: texto puro.
  return { estrutura: { ...VAZIO }, textoSolto: s };
}

/**
 * Forma que a página de Branding espera receber: sempre os seis campos, com o
 * texto que não coube em campo nenhum anexado a `history` — que é o campo de
 * forma livre. Usado na LEITURA da config, para que dado antigo (texto puro,
 * JSON+texto, ou aninhado) chegue à tela já corrigido.
 */
export function normalizarParaFormulario(
  bruto: string | null | undefined,
  nomeDaMarca?: string | null,
): GuidelinesEstruturado {
  const { estrutura, textoSolto } = lerGuidelines(bruto);
  const partes = [estrutura.history.trim(), textoSolto.trim()].filter(Boolean);

  // O nome real nunca chegou a ser gravado: o formulário nasce com o
  // placeholder "Nome da Marca" e era ele que ia para o banco. Como `Brand.name`
  // tem o nome de verdade, ele entra como base quando o campo está vazio — sem
  // sobrescrever o que alguém tenha digitado.
  const name = estrutura.name || (nomeDaMarca ?? '').trim();

  return { ...estrutura, name, history: Array.from(new Set(partes)).join('\n\n') };
}

/**
 * Mescla o que a IA extraiu do brandbook no que já existia, SEM quebrar o
 * formato. Substitui a concatenação de string que causava o estrago.
 *
 * O texto novo entra em `history`, que é o campo de forma livre — anexado ao
 * que já estava lá, não por cima, para não apagar o que o humano escreveu.
 */
export function mesclarGuidelines(atual: string | null | undefined, extraidoPelaIa: string | null | undefined): string {
  const { estrutura, textoSolto } = lerGuidelines(atual);
  const novo = (extraidoPelaIa ?? '').trim();

  const partes = [estrutura.history.trim(), textoSolto.trim(), novo].filter(Boolean);
  // `Set` porque reingerir o mesmo brandbook duplicaria o bloco inteiro.
  estrutura.history = Array.from(new Set(partes)).join('\n\n');

  return JSON.stringify(estrutura);
}
