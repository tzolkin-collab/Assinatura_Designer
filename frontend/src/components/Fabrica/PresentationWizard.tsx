"use client";

import React, { useMemo, useRef, useState } from 'react';
import { AlignLeft, BarChart3, Columns2, FileText, LayoutTemplate, Paperclip, Quote, Rows3, Sparkles, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import LayoutCard from './Cards/LayoutCard';
import styles from './PresentationWizard.module.css';

export type PresentationPageSize = 'landscape-16-9' | 'landscape-4-3' | 'a4-portrait' | 'a4-landscape';
export type PresentationDensity = 'brief' | 'medium' | 'detailed';
export type PresentationLayoutId =
  | 'ai-decide'
  | 'text-left-image-right'
  | 'image-left-text-right'
  | 'title-top-bullets'
  | 'quote'
  | 'timeline'
  | 'stats';

export type DesignReference = {
  id: string;
  title: string;
  style: string;
  palette: string[];
  relevance: string;
  source: 'ai' | 'manual';
};

export type ReferenceAsset = {
  name: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes: number;
};

export type ProjectImageAsset = ReferenceAsset & {
  source?: 'upload' | 'ai' | 'logo';
};

export type PresentationWizardValue = {
  layoutId: PresentationLayoutId | null;
  pageSize: PresentationPageSize;
  slideCount: 5 | 6 | 7 | 8;
  density: PresentationDensity;
  inputMode: 'text' | 'asset' | 'both';
  inputText: string;
  referenceAsset: ReferenceAsset | null;
  projectAssets: ProjectImageAsset[];
  designReferences: DesignReference[];
};

export type PresentationDims = { width: number; height: number; label: string };

const PAGE_SIZES: Array<{ id: PresentationPageSize; label: string; width: number; height: number }> = [
  { id: 'landscape-16-9', label: 'Paisagem 16:9', width: 1920, height: 1080 },
  { id: 'landscape-4-3', label: 'Paisagem 4:3', width: 1600, height: 1200 },
  { id: 'a4-landscape', label: 'A4 Paisagem', width: 3508, height: 2480 },
  { id: 'a4-portrait', label: 'A4 Retrato', width: 2480, height: 3508 },
];

const LAYOUTS: Array<{ id: PresentationLayoutId; label: string; desc: string; longDesc: string; icon: React.ReactNode }> = [
  {
    id: 'ai-decide',
    label: 'IA Decide',
    desc: 'Otimizado por slide',
    longDesc: 'A inteligência artificial escolherá o melhor layout para cada slide individualmente, baseando-se no conteúdo gerado. Ideal para decks dinâmicos.',
    icon: <Sparkles size={18} />,
  },
  {
    id: 'text-left-image-right',
    label: 'Texto | Imagem',
    desc: 'Texto à esquerda, imagem à direita',
    longDesc: 'Ideal para explicar um conceito com apoio visual (produto, exemplo, screenshot). Bom para 1 ideia por slide.',
    icon: <Columns2 size={18} />,
  },
  {
    id: 'image-left-text-right',
    label: 'Imagem | Texto',
    desc: 'Imagem à esquerda, texto à direita',
    longDesc: 'Funciona bem quando a imagem é o foco (antes/depois, mockup) e o texto complementa com bullets curtos.',
    icon: <Columns2 size={18} />,
  },
  {
    id: 'title-top-bullets',
    label: 'Título + bullets',
    desc: 'Título e lista clara',
    longDesc: 'O layout mais "neutro". Ótimo para tópicos, passo a passo e explicações rápidas com boa legibilidade.',
    icon: <Rows3 size={18} />,
  },
  {
    id: 'quote',
    label: 'Citação',
    desc: 'Quote destacado',
    longDesc: 'Para reforçar posicionamento, prova social e frases de impacto. Pouco texto, alto contraste e respiro.',
    icon: <Quote size={18} />,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    desc: 'Etapas em sequência',
    longDesc: 'Perfeito para processos (antes → durante → depois), cronogramas e jornadas. Mantém progressão visual.',
    icon: <LayoutTemplate size={18} />,
  },
  {
    id: 'stats',
    label: 'Métricas',
    desc: 'KPIs e rótulos',
    longDesc: 'Para resultados e números. Use 2–4 KPIs por slide com rótulos curtos e destaque visual.',
    icon: <BarChart3 size={18} />,
  },
];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${Math.round(mb * 10) / 10} MB`;
}

async function readFileAsBase64(file: File): Promise<ReferenceAsset> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    dataBase64: btoa(binary),
    sizeBytes: file.size,
  };
}

type Props = {
  value: PresentationWizardValue;
  onChange: (next: PresentationWizardValue) => void;
  onEnterInsumos: () => void;
  generating: boolean;
};

export default function PresentationWizard({ value, onChange, onEnterInsumos, generating }: Props) {
  const [fileError, setFileError] = useState<string>('');
  const [refDragActive, setRefDragActive] = useState(false);

  const refFileInputRef = useRef<HTMLInputElement | null>(null);

  const dims: PresentationDims = useMemo(() => {
    const size = PAGE_SIZES.find((s) => s.id === value.pageSize) ?? PAGE_SIZES[0];
    return { width: size.width, height: size.height, label: `${size.width}×${size.height}` };
  }, [value.pageSize]);

  const selectedLayout = useMemo(() => {
    if (!value.layoutId) return null;
    return LAYOUTS.find((l) => l.id === value.layoutId) ?? null;
  }, [value.layoutId]);

  const canProceed = value.layoutId !== null;

  const attachRefFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setFileError('Arquivo muito grande (limite 15 MB).');
      return;
    }
    setFileError('');
    const asset = await readFileAsBase64(file);
    const nextText = asset && value.inputText.trim().length > 0 ? value.inputText : value.inputText;
    const normalizedMode: PresentationWizardValue['inputMode'] =
      asset && nextText.trim().length > 0 ? 'both' : asset ? 'asset' : 'text';
    onChange({ ...value, referenceAsset: asset, inputMode: normalizedMode });
  };

  return (
    <div className={styles.wizard}>
      <div className={styles.wizardHeader}>
        <Sparkles size={24} className={styles.wizardHeaderIcon} />
        <div className={styles.wizardHeaderTexts}>
          <div className={styles.wizardTitle}>Configuração da Apresentação</div>
          <div className={styles.wizardSubtitle}>Defina o estilo e estrutura. O conteúdo guiará o resto.</div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>
            <div className={styles.title}>1) Escolha o layout base</div>
            <div className={styles.subtitle}>A IA usará isso como referência principal, mas otimizará por slide.</div>
          </div>
        </div>

          <div className={styles.layoutGrid}>
            {LAYOUTS.map((l) => (
              <LayoutCard
                key={l.id}
                id={l.id}
                label={l.label}
                description={l.desc}
                icon={l.icon}
                isActive={value.layoutId === l.id}
                onClick={() => onChange({ ...value, layoutId: l.id })}
              />
            ))}
          </div>

          {selectedLayout && (
            <div className={styles.layoutDetails} aria-live="polite">
              <Card padding="md">
                <div className={styles.layoutDetailsTop}>
                  <div className={styles.layoutDetailsTitle}>
                    <span className={styles.layoutDetailsBadge}>Selecionado</span>
                    <span>{selectedLayout.label}</span>
                  </div>
                  <div className={styles.layoutDetailsIcon} aria-hidden>
                    {selectedLayout.icon}
                  </div>
                </div>
                <div className={styles.layoutDetailsText}>{selectedLayout.longDesc}</div>
              </Card>
            </div>
          )}
        </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>
            <div className={styles.title}>2) Tamanho e estrutura</div>
            <div className={styles.subtitle}>Defina formato, quantidade e densidade. Dimensões: {dims.label}</div>
          </div>
        </div>

          <Card padding="md" config>
            <div className={styles.fieldGroup}>
              <div className={styles.fieldLabel}>Tamanho</div>
              <div className={styles.segmented}>
                {PAGE_SIZES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={[styles.segBtn, value.pageSize === s.id ? styles.segBtnActive : ''].join(' ')}
                    onClick={() => onChange({ ...value, pageSize: s.id })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className={styles.fieldHint}>Presets são fixos para garantir resultado consistente.</div>
            </div>
          </Card>

          <Card padding="md" config>
            <div className={styles.fieldGroup}>
              <div className={styles.fieldLabel}>Slides</div>
              <div className={styles.segmented}>
                {[5, 6, 7, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={[styles.segBtn, value.slideCount === n ? styles.segBtnActive : ''].join(' ')}
                    onClick={() => onChange({ ...value, slideCount: n as PresentationWizardValue['slideCount'] })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card padding="md" config>
            <div className={styles.fieldGroup}>
              <div className={styles.fieldLabel}>Densidade</div>
              <div className={styles.segmented}>
                {(
                  [
                    { id: 'brief', label: 'Breve' },
                    { id: 'medium', label: 'Média' },
                    { id: 'detailed', label: 'Detalhada' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={[styles.segBtn, value.density === d.id ? styles.segBtnActive : ''].join(' ')}
                    onClick={() => onChange({ ...value, density: d.id })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Reference asset */}
          <Card padding="md" config>
            <div className={styles.fieldGroup}>
              <div className={styles.fieldLabel}>Referência visual</div>
              <div className={styles.fieldHint}>
                PDF, imagem ou texto de referência para guiar o estilo do deck.
              </div>

              {value.referenceAsset ? (
                <div className={styles.attachmentPill}>
                  <span className={styles.attachmentName}>{value.referenceAsset.name}</span>
                  <span className={styles.attachmentSize}>{formatBytes(value.referenceAsset.sizeBytes)}</span>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Remover referência"
                    onClick={() => onChange({ ...value, referenceAsset: null, inputMode: value.inputText.trim() ? 'text' : 'text' })}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div
                  className={[styles.assetsDropzone, refDragActive ? styles.assetsDropzoneActive : ''].join(' ')}
                  onDragOver={(e) => { e.preventDefault(); setRefDragActive(true); }}
                  onDragLeave={() => setRefDragActive(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setRefDragActive(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) await attachRefFile(file);
                  }}
                >
                  <div className={styles.assetsTopRow}>
                    <div>
                      <div className={styles.dropTitle}>Anexar referência</div>
                      <div className={styles.dropSub}>PDF, imagem, áudio ou texto (máx 15 MB)</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => refFileInputRef.current?.click()}
                    >
                      <Paperclip size={14} />
                      Selecionar
                    </Button>
                  </div>
                  {fileError && <div className={styles.composerError}>{fileError}</div>}
                </div>
              )}

              <input
                ref={refFileInputRef}
                className={styles.hiddenFile}
                type="file"
                accept="application/pdf,text/plain,text/markdown,audio/*,image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await attachRefFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          </Card>

        </div>
      
      <div className={styles.wizardFooter}>
        <Button size="lg" className={styles.startBtn} onClick={onEnterInsumos} disabled={generating || !canProceed}>
          {generating ? <span className={styles.spinIcon}><Sparkles size={18}/> Gerando Apresentação...</span> : <><Sparkles size={18} /> Começar a Criar</>}
        </Button>
      </div>
    </div>
  );
}
