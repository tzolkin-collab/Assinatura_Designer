// Teste 2 do Cérebro de IA (§14): "Slide com foto real. Enviar foto da Amanda. Esperado: a composição usa a
// foto real e preserva seus traços". Aqui os critérios mensuráveis viram código, para o teste ser repetível e
// dizer PASSA ou FALHA por critério, em vez de uma opinião. O que só um olho humano julga fica marcado como
// "manual": o código não finge que conferiu.

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'manual';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface RunEvidence {
  slides: Array<{ html: string }>;
  /** Fotos reais da biblioteca (candidatas): o que a pessoa forneceu, sem logo, referência nem IA. */
  photos: Array<{ url: string; name: string }>;
  /** TODAS as URLs da biblioteca do projeto (fotos, logos, ícones): qualquer imagem fora daqui é intrusa. */
  libraryUrls: ReadonlySet<string>;
  /** Quantos arquivos o sistema GEROU nesta execução (assets ligados ao deck). Tem de ser zero. */
  generatedAssets: number;
}

interface ImgTag {
  src: string;
  style: string;
}

function imgsOf(html: string): ImgTag[] {
  const out: ImgTag[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src) continue;
    out.push({ src, style: /\bstyle="([^"]*)"/i.exec(tag)?.[1] ?? '' });
  }
  return out;
}

const hasUnsafeFilter = (style: string): boolean => {
  const filter = /(?:^|;)\s*filter\s*:\s*([^;]+)/i.exec(style)?.[1];
  if (!filter) return false;
  // P&B e ajuste de luz/contraste são tratamento permitido (§5.1); o resto muda a pessoa ou a cor da pele.
  return filter.split(/\)\s*/).filter(Boolean).some((f) => !/^(grayscale|contrast|brightness|saturate)\(/i.test(f.trim()));
};

export function evaluateRealPhotoRun(ev: RunEvidence): CheckResult[] {
  const photoUrls = new Set(ev.photos.map((p) => p.url));
  const all = ev.slides.flatMap((s, i) => imgsOf(s.html).map((img) => ({ ...img, slide: i + 1 })));
  const used = all.filter((i) => photoUrls.has(i.src));
  const intruders = all.filter((i) => !ev.libraryUrls.has(i.src));
  const results: CheckResult[] = [];

  results.push(
    ev.photos.length === 0
      ? { id: 'ha-fotos', label: 'Há fotos reais na biblioteca', status: 'fail', detail: 'A biblioteca não tem nenhuma foto enviada: o Teste 2 não pode rodar.' }
      : { id: 'ha-fotos', label: 'Há fotos reais na biblioteca', status: 'pass', detail: `${ev.photos.length} foto(s) disponíveis.` },
  );

  results.push(
    used.length > 0
      ? { id: 'usa-foto-real', label: 'A composição usa uma foto real fornecida', status: 'pass', detail: `${new Set(used.map((u) => u.src)).size} foto(s) em ${new Set(used.map((u) => u.slide)).size} slide(s).` }
      : { id: 'usa-foto-real', label: 'A composição usa uma foto real fornecida', status: 'fail', detail: 'Nenhum slide traz uma foto da biblioteca.' },
  );

  results.push(
    ev.generatedAssets === 0
      ? { id: 'sem-ia', label: 'Nada foi gerado por IA nesta execução', status: 'pass', detail: 'Nenhum arquivo novo gerado.' }
      : { id: 'sem-ia', label: 'Nada foi gerado por IA nesta execução', status: 'fail', detail: `${ev.generatedAssets} arquivo(s) gerado(s) pelo sistema.` },
  );

  results.push(
    intruders.length === 0
      ? { id: 'sem-intrusa', label: 'Nenhuma imagem de fora da biblioteca', status: 'pass', detail: 'Toda imagem do deck é da biblioteca do projeto.' }
      : { id: 'sem-intrusa', label: 'Nenhuma imagem de fora da biblioteca', status: 'fail', detail: `${intruders.length} imagem(ns) de fora: ${intruders.slice(0, 2).map((i) => i.src.slice(0, 60)).join(', ')}.` },
  );

  const alterada = used.filter((u) => hasUnsafeFilter(u.style) || /transform\s*:/i.test(u.style) || /mix-blend-mode\s*:/i.test(u.style));
  results.push(
    used.length === 0
      ? { id: 'foto-intacta', label: 'A foto não é alterada (só enquadramento e tratamento permitido)', status: 'manual', detail: 'Sem foto usada, nada a conferir.' }
      : alterada.length === 0
        ? { id: 'foto-intacta', label: 'A foto não é alterada (só enquadramento e tratamento permitido)', status: 'pass', detail: 'Sem filtro de cor, espelhamento nem mistura de camadas na foto. O arquivo é o original da biblioteca.' }
        : { id: 'foto-intacta', label: 'A foto não é alterada (só enquadramento e tratamento permitido)', status: 'warn', detail: `${alterada.length} foto(s) com filtro, transformação ou mistura de camadas: conferir se mudou a pessoa.` },
  );

  const centradas = used.filter((u) => {
    const m = /object-position\s*:\s*([\d.]+)%\s+([\d.]+)%/i.exec(u.style);
    return !m || (parseFloat(m[1]!) === 50 && parseFloat(m[2]!) === 50);
  });
  results.push(
    used.length === 0
      ? { id: 'enquadramento', label: 'A foto foi enquadrada pelo rosto, não pelo centro', status: 'manual', detail: 'Sem foto usada, nada a conferir.' }
      : centradas.length === 0
        ? { id: 'enquadramento', label: 'A foto foi enquadrada pelo rosto, não pelo centro', status: 'pass', detail: 'Todas as fotos usadas têm enquadramento calculado.' }
        : { id: 'enquadramento', label: 'A foto foi enquadrada pelo rosto, não pelo centro', status: 'warn', detail: `${centradas.length} foto(s) ficaram centralizadas (sem enquadramento): conferir se cortou o rosto.` },
  );

  results.push({
    id: 'rosto-sem-texto',
    label: 'Sem texto sobre o rosto e traços preservados',
    status: 'manual',
    detail: 'Só um olho humano julga: abrir os slides com foto e conferir rosto, olhos e leitura do texto.',
  });

  return results;
}

/** O teste passa quando nenhum critério falhou. "manual" e "warn" não bloqueiam, mas aparecem. */
export function acceptancePassed(results: CheckResult[]): boolean {
  return !results.some((r) => r.status === 'fail');
}
