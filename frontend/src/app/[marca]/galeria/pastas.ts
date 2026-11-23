export type FolderNode = { id: string; name: string; parentId: string | null };

/** Agrupa as pastas por pai. O backend devolve lista plana; a árvore é montada aqui. */
export function groupByParent(folders: FolderNode[]): Map<string | null, FolderNode[]> {
  const byParent = new Map<string | null, FolderNode[]>();
  // Um pai que não está na lista (não deveria acontecer) viraria uma pasta órfã e
  // invisível; tratamos como raiz para nunca sumir com a pasta do usuário.
  const ids = new Set(folders.map((f) => f.id));
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(folder);
    byParent.set(parent, siblings);
  }
  return byParent;
}

/** Ids da subárvore de `folderId`, incluindo ela mesma: destinos proibidos ao mover. */
export function collectSubtree(folderId: string, byParent: Map<string | null, FolderNode[]>): Set<string> {
  const blocked = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      if (blocked.has(child.id)) continue; // ciclo vindo do banco
      blocked.add(child.id);
      queue.push(child.id);
    }
  }
  return blocked;
}

/**
 * Da raiz até a pasta (inclusive): é o caminho que aparece no topo da pasta aberta.
 * Pai que não existe mais (pasta órfã) encerra o caminho, e um ciclo vindo do banco também,
 * em vez de travar a tela.
 */
export function caminhoDaPasta(folderId: string, folders: FolderNode[]): FolderNode[] {
  const porId = new Map(folders.map((f) => [f.id, f]));
  const caminho: FolderNode[] = [];
  const vistos = new Set<string>();
  let atual = porId.get(folderId);
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    caminho.unshift(atual);
    atual = atual.parentId ? porId.get(atual.parentId) : undefined;
  }
  return caminho;
}

/**
 * Artes de uma pasta e das subpastas dela, mais recentes primeiro. A pasta mostra as capas
 * do que tem dentro (inclusive nas subpastas): uma pasta só com subpastas não pode parecer vazia.
 */
export function artesDaPasta<T extends { folderId?: string | null; createdAt?: string }>(
  folderId: string,
  byParent: Map<string | null, FolderNode[]>,
  posts: T[],
): T[] {
  const ids = collectSubtree(folderId, byParent);
  return posts
    .filter((p) => !!p.folderId && ids.has(p.folderId))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** "3 artes · 1 subpasta", "1 arte", "Vazia". */
export function resumoDaPasta(artes: number, subpastas: number): string {
  const partes: string[] = [];
  if (artes > 0) partes.push(`${artes} ${artes === 1 ? 'arte' : 'artes'}`);
  if (subpastas > 0) partes.push(`${subpastas} ${subpastas === 1 ? 'subpasta' : 'subpastas'}`);
  return partes.length ? partes.join(' · ') : 'Vazia';
}
