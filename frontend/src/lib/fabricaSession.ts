export const SESSION_PHASES = [
  'listening',
  'clarifying',
  'ready',
  'running',
  'reviewing',
  'revising',
  'done',
  'error',
] as const;

export type SessionPhase = typeof SESSION_PHASES[number];

export type WorkerStatus = 'idle' | 'running' | 'done' | 'error';

export type ReviewMode = 'auto' | 'manual';

export type FabricaQuestionKind = 'palette' | 'format' | 'priority' | 'brief' | 'style' | 'generic' | 'image-candidates' | 'font-compare';

export interface FabricaQuestionOption {
  id: string;
  label: string;
  description?: string;
  value?: string;
  /** Miniatura clicável (ex.: comparação de fonte original vs sugerida). */
  imageUrl?: string;
}

export interface FabricaQuestion {
  id: string;
  kind: FabricaQuestionKind;
  question: string;
  options: FabricaQuestionOption[];
  allowFreeform: boolean;
  allowSkip: boolean;
  mode: ReviewMode;
  field?: string;
  helperText?: string;
  /** Miniaturas só ilustrativas acima das opções (ex.: bundle de candidatos de
   *  imagem da biblioteca) — não são clicáveis, ao contrário de options[].imageUrl. */
  previewImages?: Array<{ url: string; label: string }>;
}

export interface PresentationConfig {
  autoMode?: boolean;
  requirePaletteConfirmation?: boolean;
  paletteApproved?: string[];
  paletteDirection?: string;
  paletteNotes?: string;
  visualVibe?: string;
  boldness?: 'safe' | 'balanced' | 'bold';
  photoPreference?: 'minimal' | 'balanced' | 'high';
  imageryStyle?: string;
  allowGeneratedGraphics?: boolean;
  allowSvgLayouts?: boolean;
  notes?: string;
}

export function isActiveGenerationPhase(phase: SessionPhase): boolean {
  return phase === 'running' || phase === 'reviewing' || phase === 'revising';
}
