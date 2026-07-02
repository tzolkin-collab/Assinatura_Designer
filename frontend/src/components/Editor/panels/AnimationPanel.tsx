'use client';

import { Zap, Play } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, inputCss } from './shared';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
  onPreview?: () => void;
}

const PRESETS: { value: NonNullable<Layer['animationIn']>; label: string }[] = [
  { value: 'none',        label: 'Nenhuma' },
  { value: 'fade',        label: 'Fade' },
  { value: 'slide-up',    label: 'Slide — cima' },
  { value: 'slide-down',  label: 'Slide — baixo' },
  { value: 'slide-left',  label: 'Slide — direita' },
  { value: 'slide-right', label: 'Slide — esquerda' },
  { value: 'zoom-in',     label: 'Zoom in' },
  { value: 'zoom-out',    label: 'Zoom out' },
  { value: 'blur-in',     label: 'Blur in' },
];

export default function AnimationPanel({ layer, onChange, onPreview }: Props) {
  const id = layer.id;
  const current = layer.animationIn ?? 'none';
  const hasAnim = current !== 'none';

  return (
    <Section title="Animação" icon={<Zap size={11} />}>
      <Field label="Entrada">
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            key={`${id}-anim`}
            style={{ ...inputCss, flex: 1 }}
            defaultValue={current}
            onChange={(e) => onChange({ animationIn: e.target.value as Layer['animationIn'] })}
          >
            {PRESETS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            title="Visualizar animação"
            disabled={!hasAnim || !onPreview}
            onClick={onPreview}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              flexShrink: 0,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)',
              color: hasAnim ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              cursor: hasAnim ? 'pointer' : 'default',
              opacity: hasAnim ? 1 : 0.4,
            }}
          >
            <Play size={10} fill="currentColor" />
          </button>
        </div>
      </Field>

      {hasAnim && (
        <Grid2>
          <Field label="Duração">
            <NumInput
              id={`${id}-adur`}
              defaultVal={layer.animationDuration ?? 0.5}
              step={0.05}
              min={0.05}
              max={3}
              onCommit={(v) => onChange({ animationDuration: v })}
              suffix="s"
            />
          </Field>
          <Field label="Atraso">
            <NumInput
              id={`${id}-adel`}
              defaultVal={layer.animationDelay ?? 0}
              step={0.05}
              min={0}
              max={5}
              onCommit={(v) => onChange({ animationDelay: v })}
              suffix="s"
            />
          </Field>
        </Grid2>
      )}
    </Section>
  );
}
