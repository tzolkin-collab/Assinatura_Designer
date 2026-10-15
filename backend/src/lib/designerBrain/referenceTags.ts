/**
 * Ativos de REFERÊNCIA do projeto (manual visual, moodboard, referência de fonte e de paleta).
 * Servem para o modelo VER a direção de arte, nunca para entrar num slide: ficam fora da lista de
 * arquivos oferecidos ao artista e fora da contagem de "fotos reais disponíveis".
 */
export const REFERENCE_ASSET_TAGS = ['visual-manual', 'moodboard', 'font-reference', 'palette-reference'] as const;

/**
 * O que nunca é candidato a FOTO de slide: material de referência e logos. O resolvedor escolhe a foto de
 * cada slide entre os arquivos mais recentes da biblioteca; sem este filtro os logos (enviados por último)
 * tomavam as vagas e podiam ser "reaproveitados" como se fossem foto.
 */
export const NON_PHOTO_ASSET_TAGS = [...REFERENCE_ASSET_TAGS, 'logo', 'LOGOTYPE'] as const;
