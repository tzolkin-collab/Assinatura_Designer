// Nome do deck gerado. Sem isso o deck nascia sem nome e aparecia como "Sem nome" na galeria
// e nas apresentações publicadas (achado S8). O nome vem do próprio conteúdo: a primeira linha
// do texto da capa e, na falta dele, o título do planner, desde que não seja um rótulo genérico.

const GENERICOS = /^(capa|cover|slide\s*\d*|abertura|intro(dução)?|título|titulo)$/i;
const MAX = 80;

const limpa = (t: string): string => t.replace(/\s+/g, ' ').replace(/^[\s"'“”«»\-–—•*#]+|[\s"'“”«»\-–—•*#.,;:]+$/g, '').trim();

const corta = (t: string): string => {
  if (t.length <= MAX) return t;
  const parte = t.slice(0, MAX);
  const ate = parte.lastIndexOf(' ');
  return `${(ate > 40 ? parte.slice(0, ate) : parte).trim()}…`;
};

/** `null` quando não há de onde tirar um nome (o app mostra o padrão dele). */
export function deriveDeckName(skeleton: Array<{ title?: string; copy?: string }>): string | null {
  const capa = skeleton[0];
  if (!capa) return null;
  const primeiraLinha = (capa.copy ?? '').split(/\r?\n/).map(limpa).find((l) => l.length > 0);
  if (primeiraLinha) return corta(primeiraLinha);
  const titulo = limpa(capa.title ?? '');
  if (titulo && !GENERICOS.test(titulo)) return corta(titulo);
  return null;
}
