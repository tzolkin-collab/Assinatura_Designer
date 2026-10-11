// Foto real é regra absoluta no cérebro: o artista só pode usar o que alguém FORNECEU.
//
// A biblioteca da marca guarda também o que o sistema gerou sozinho (`source: 'ai-generated'`),
// inclusive "fotos" de pessoas feitas por IA em gerações antigas. Visto em geração real da Amanda
// (11/10): três slides reaproveitaram uma "Amanda" sintética criada em 06/10, e o revisor reprovou
// por foto inventada. Com o cérebro ligado, o que foi gerado por IA não é oferecido ao artista.

export const AI_GENERATED_SOURCE = 'ai-generated';

export function onlyProvidedAssets<T extends { source?: string | null }>(assets: T[]): T[] {
  return assets.filter((a) => a.source !== AI_GENERATED_SOURCE);
}
