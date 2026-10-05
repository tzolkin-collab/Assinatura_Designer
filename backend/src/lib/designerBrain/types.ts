// Tipos da montagem do cérebro do Designer em camadas.
// Fonte: "CÉREBRO DE IA DO SISTEMA DESIGNER" §1, §4, §9 e §16.

/** §7 — o tipo de peça ativa um conjunto próprio de regras; elas não se misturam. */
export type ProductionMode = 'presentation' | 'single-image' | 'ebook-a4';

/**
 * §4.1 — status obrigatório de cada bloco de texto do briefing.
 * Só `approved` pode aparecer na arte (literalmente). O resto orienta ou é proibido.
 */
export type TextStatus =
  | 'approved' // reproduzir literalmente; pode aparecer
  | 'in-review' // pode ser diagramado como rascunho, mas não chamado de final
  | 'support' // só aparece se o briefing autorizar
  | 'speech' // fala: orienta a apresentação, não vira texto visual
  | 'context' // orienta raciocínio e narrativa; não é texto de peça
  | 'internal' // informação operacional/comercial não exibível
  | 'do-not-show'; // proibido colocar na arte

export interface TextBlock {
  status: TextStatus;
  text: string;
  /** Rótulo opcional, ex.: "Slide 3". Só ajuda a IA a localizar o bloco. */
  label?: string;
}

/** Ativo real (logo, ícone, foto, manual...) do projeto-base ou da camada de collab. */
export interface BrainAsset {
  name: string;
  url: string;
  role: 'logo' | 'icon' | 'palette' | 'font' | 'visual-manual' | 'photo' | 'reference' | 'other';
}

/** Camada 2 — memória do projeto-base. Só carregada para o projeto ativo. */
export interface ProjectLayer {
  name: string;
  /** Texto da memória (prompt de memória, §10.1 / §11.10). */
  memory: string;
  assets?: BrainAsset[];
}

/** Camada 3 (opcional) — guarda SÓ o que muda em relação ao projeto-base. */
export interface CollabLayer {
  name: string;
  kind: 'internal' | 'partnership';
  /** Contexto/objetivo, parceiro, guia visual, protagonismo — apenas as diferenças. */
  memory: string;
  /** Percentual da marca-mãe que lidera a narrativa visual (ex.: 70). Só em parceria. */
  leadPercent?: number;
  assets?: BrainAsset[];
}

/** Camada 4 — a criação do momento. */
export interface CreationBriefing {
  mode: ProductionMode;
  blocks: TextBlock[];
  /** Instrução específica da peça (objetivo, público, quantidade, formato...). */
  instruction?: string;
  /** A peça tem fotografia ou área fotográfica? Aciona a regra de foto real (§5.1). */
  hasPhotoOrPhotoArea?: boolean;
  /** Proporção da imagem avulsa (1:1, 4:5, 9:16...). Obrigatória nesse modo (§7.2). */
  aspectRatio?: string;
  /** Quantidade fechada de slides/páginas, quando houver. */
  pageCount?: number;
  /** Ativos específicos desta demanda (fotos, logos, gráficos, QR Codes...). */
  assets?: BrainAsset[];
}

export interface AssembleInput {
  project: ProjectLayer;
  collab?: CollabLayer | null;
  creation: CreationBriefing;
}

export type SectionId =
  | 'global'
  | 'project'
  | 'collab'
  | 'mode'
  | 'photo-rule'
  | 'assets'
  | 'briefing'
  | 'review';

export interface PromptSection {
  id: SectionId;
  text: string;
}

export interface AssembledBrain {
  /** Seções na ordem do §16. */
  sections: PromptSection[];
  /** As seções unidas, prontas para `systemInstruction`. */
  prompt: string;
  /**
   * §13 — o que falta. Nunca é preenchido com invenção: o chamador decide se bloqueia
   * ou segue só com o que é seguro (§3.1, item 2).
   */
  pending: string[];
}
