'use client';

import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignLeft, AlignCenter, AlignRight,
  Contrast, StretchHorizontal, StretchVertical, Type,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd
} from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, ColorSwatch, inputCss } from './shared';
import FontPicker from './FontPicker';

interface Props {
  selectedLayers: Layer[];
  canvasWidth: number;
  canvasHeight: number;
  onChange: (updates: Map<string, Partial<Layer>>) => void;
}

// ── Bounding box helpers ──────────────────────────────────────────────────────

function getBBox(layers: Layer[]) {
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  const maxX = Math.max(...layers.map((l) => l.x + l.width));
  const maxY = Math.max(...layers.map((l) => l.y + l.height));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
}

// ── Distribution functions ───────────────────────────────────────────────────

function distributeH(layers: Layer[]): Map<string, Partial<Layer>> {
  if (layers.length < 3) return new Map();
  const sorted = [...layers].sort((a, b) => a.x - b.x);
  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
  const totalW = sorted.reduce((s, l) => s + l.width, 0);
  const gap = (maxX - minX - totalW) / (sorted.length - 1);
  const updates = new Map<string, Partial<Layer>>();
  let cursor = minX;
  for (const l of sorted) {
    updates.set(l.id, { x: cursor });
    cursor += l.width + gap;
  }
  return updates;
}

function distributeV(layers: Layer[]): Map<string, Partial<Layer>> {
  if (layers.length < 3) return new Map();
  const sorted = [...layers].sort((a, b) => a.y - b.y);
  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
  const totalH = sorted.reduce((s, l) => s + l.height, 0);
  const gap = (maxY - minY - totalH) / (sorted.length - 1);
  const updates = new Map<string, Partial<Layer>>();
  let cursor = minY;
  for (const l of sorted) {
    updates.set(l.id, { y: cursor });
    cursor += l.height + gap;
  }
  return updates;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const textAlignments = [
  { value: 'left', icon: <AlignLeft size={12} /> },
  { value: 'center', icon: <AlignCenter size={12} /> },
  { value: 'right', icon: <AlignRight size={12} /> },
] as const;

const verticalAlignments = [
  { value: 'top', icon: <AlignVerticalJustifyStart size={12} /> },
  { value: 'middle', icon: <AlignVerticalJustifyCenter size={12} /> },
  { value: 'bottom', icon: <AlignVerticalJustifyEnd size={12} /> },
] as const;

const decorations: { value: Layer['textDecoration']; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'underline', label: 'U̲' },
  { value: 'line-through', label: 'S̶' },
];

const toolBtn = (active?: boolean): React.CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 0',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: active ? 'var(--color-accent)' : 'var(--color-bg)',
  color: active ? '#fff' : 'var(--color-text-secondary)',
  cursor: 'pointer',
  transition: 'all 120ms',
});

// ── Component ─────────────────────────────────────────────────────────────────

import AlignPanel from './AlignPanel';

export default function MultiSelectPanel({ selectedLayers, canvasWidth, canvasHeight, onChange }: Props) {
  if (selectedLayers.length === 0) return null;

  const bbox = getBBox(selectedLayers);
  const canDistribute = selectedLayers.length >= 3;
  const textLayers = selectedLayers.filter((layer) => layer.type === 'text');
  const onlyTextLayers = textLayers.length === selectedLayers.length && textLayers.length >= 2;
  const firstText = textLayers[0];

  const applyToTextLayers = (overrides: Partial<Layer>) => {
    onChange(new Map(textLayers.map((layer) => [layer.id, overrides])));
  };

  const applyMove = (newX: number, newY: number) => {
    const dx = newX - bbox.x;
    const dy = newY - bbox.y;
    onChange(new Map(selectedLayers.map((l) => [l.id, { x: l.x + dx, y: l.y + dy }])));
  };

  const applyScale = (newW: number, newH: number) => {
    const scaleX = newW / bbox.w;
    const scaleY = newH / bbox.h;
    onChange(
      new Map(
        selectedLayers.map((l) => ({
          id: l.id,
          x: bbox.x + (l.x - bbox.x) * scaleX,
          w: l.width * scaleX,
          y: bbox.y + (l.y - bbox.y) * scaleY,
          h: l.height * scaleY,
        })).map(({ id, x, w, y, h }) => [id, { x, width: w, y, height: h }])
      )
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      {/* Badge */}
      <div style={{
        fontSize: 11, color: 'var(--color-text-secondary)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '5px 8px',
        textAlign: 'center',
      }}>
        {selectedLayers.length} camadas selecionadas
      </div>

      {/* Bounding box position + size */}
      <Section title="Seleção">
        <Grid2>
          <Field label="X">
            <NumInput id="ms-x" defaultVal={Math.round(bbox.x)}
              onCommit={(v) => applyMove(v, bbox.y)} suffix="px" />
          </Field>
          <Field label="Y">
            <NumInput id="ms-y" defaultVal={Math.round(bbox.y)}
              onCommit={(v) => applyMove(bbox.x, v)} suffix="px" />
          </Field>
          <Field label="Largura">
            <NumInput id="ms-w" defaultVal={Math.round(bbox.w)}
              onCommit={(v) => applyScale(v, bbox.h)} suffix="px" />
          </Field>
          <Field label="Altura">
            <NumInput id="ms-h" defaultVal={Math.round(bbox.h)}
              onCommit={(v) => applyScale(bbox.w, v)} suffix="px" />
          </Field>
        </Grid2>
      </Section>

      {/* Alignment */}
      <AlignPanel
        layers={selectedLayers}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        onChange={onChange}
      />

      {onlyTextLayers && firstText && (
        <Section title="Texto em lote" icon={<Type size={11} />}>
          <Grid2>
            <Field label="Tamanho">
              <NumInput
                id="ms-text-fs"
                defaultVal={firstText.fontSize ?? 14}
                onCommit={(v) => applyToTextLayers({ fontSize: v })}
                suffix="px"
              />
            </Field>
            <Field label="Altura linha">
              <NumInput
                id="ms-text-lh"
                defaultVal={firstText.lineHeight ?? 1.3}
                step={0.05}
                onCommit={(v) => applyToTextLayers({ lineHeight: v })}
              />
            </Field>
          </Grid2>

          <Field label="Família">
            <FontPicker
              value={firstText.fontFamily ?? 'Inter'}
              onChange={(font) => applyToTextLayers({ fontFamily: font })}
            />
          </Field>

          <Grid2>
            <Field label="Peso">
              <select
                key="ms-text-fw"
                style={inputCss}
                defaultValue={firstText.fontWeight ?? 'normal'}
                onChange={(e) => applyToTextLayers({ fontWeight: e.target.value })}
              >
                <option value="300">Light</option>
                <option value="normal">Normal</option>
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="bold">Bold</option>
                <option value="800">Extrabold</option>
                <option value="900">Black</option>
              </select>
            </Field>
            <Field label="Espaç. letras">
              <NumInput
                id="ms-text-ls"
                defaultVal={firstText.letterSpacing ?? 0}
                step={0.5}
                onCommit={(v) => applyToTextLayers({ letterSpacing: v })}
                suffix="px"
              />
            </Field>
          </Grid2>

          <Field label="Cor">
            <ColorSwatch
              id="ms-text-color"
              value={firstText.color ?? '#000000'}
              onChange={(v) => applyToTextLayers({ color: v })}
            />
          </Field>

          <Section title="Contraste" icon={<Contrast size={11} />}>
            <Field label="Fundo do texto">
              <button
                onClick={() => applyToTextLayers({ contrastBackground: !firstText.contrastBackground })}
                style={firstText.contrastBackground ? toolBtn(true) : toolBtn()}
              >
                {firstText.contrastBackground ? 'Ativado' : 'Desativado'}
              </button>
            </Field>
            {firstText.contrastBackground && (
              <>
                <Grid2>
                  <Field label="Cor fundo">
                    <ColorSwatch
                      id="ms-text-cbg"
                      value={firstText.contrastBackgroundColor ?? '#000000'}
                      onChange={(v) => applyToTextLayers({ contrastBackgroundColor: v })}
                    />
                  </Field>
                  <Field label="Opacidade">
                    <NumInput
                      id="ms-text-cbgo"
                      defaultVal={firstText.contrastBackgroundOpacity ?? 0.72}
                      step={0.05}
                      min={0}
                      max={1}
                      onCommit={(v) => applyToTextLayers({ contrastBackgroundOpacity: v })}
                    />
                  </Field>
                </Grid2>
                <Field label="Raio">
                  <NumInput
                    id="ms-text-cbgr"
                    defaultVal={firstText.contrastBackgroundRadius ?? 12}
                    min={0}
                    onCommit={(v) => applyToTextLayers({ contrastBackgroundRadius: v })}
                    suffix="px"
                  />
                </Field>
              </>
            )}
          </Section>

          <Field label="Alinhamento">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {textAlignments.map(({ value, icon }) => (
                  <button
                    key={value}
                    onClick={() => applyToTextLayers({ textAlign: value })}
                    style={firstText.textAlign === value ? toolBtn(true) : toolBtn()}
                  >
                    {icon}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {verticalAlignments.map(({ value, icon }) => (
                  <button
                    key={value}
                    onClick={() => applyToTextLayers({ verticalAlign: value })}
                    style={firstText.verticalAlign === value ? toolBtn(true) : toolBtn()}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <Field label="Estilo">
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => applyToTextLayers({ italic: !firstText.italic })}
                style={firstText.italic ? toolBtn(true) : toolBtn()}
                title="Itálico"
              >
                <em style={{ fontStyle: 'italic', fontSize: 12 }}>I</em>
              </button>
              {decorations.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => applyToTextLayers({ textDecoration: value })}
                  style={(firstText.textDecoration ?? 'none') === value ? toolBtn(true) : toolBtn()}
                  title={value}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </Section>
      )}

      {/* Distribution (≥3 elements) */}
      <Section title="Distribuir">
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            style={toolBtn(!canDistribute ? false : undefined)}
            onClick={() => canDistribute && onChange(distributeH(selectedLayers))}
            title={canDistribute ? 'Distribuir horizontalmente' : 'Mínimo 3 elementos'}
            disabled={!canDistribute}
          >
            <StretchHorizontal size={13} />
          </button>
          <button
            style={toolBtn(!canDistribute ? false : undefined)}
            onClick={() => canDistribute && onChange(distributeV(selectedLayers))}
            title={canDistribute ? 'Distribuir verticalmente' : 'Mínimo 3 elementos'}
            disabled={!canDistribute}
          >
            <StretchVertical size={13} />
          </button>
          {!canDistribute && (
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', alignSelf: 'center', paddingLeft: 4 }}>
              mín. 3 elem.
            </span>
          )}
        </div>
      </Section>
    </div>
  );
}
