'use client';

import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, Contrast, Type, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, ColorSwatch, inputCss } from './shared';
import FontPicker from './FontPicker';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

const alignments = [
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


export default function TextPanel({ layer, onChange }: Props) {
  const id = layer.id;

  const currentAlign = layer.textAlign ?? 'left';
  const currentVAlign = layer.verticalAlign ?? 'top';
  const currentDecoration = layer.textDecoration ?? 'none';
  const isItalic = layer.italic ?? false;

  const btnBase: React.CSSProperties = {
    flex: 1,
    padding: '5px 0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    transition: 'all 120ms',
  };

  const btnActive: React.CSSProperties = {
    ...btnBase,
    background: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    color: '#fff',
  };

  return (
    <Section title="Texto" icon={<Type size={11} />}>
      <Field label="Conteúdo">
        <textarea
          style={{ ...inputCss, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }}
          key={`${id}-content`}
          defaultValue={layer.content ?? ''}
          onChange={(e) => {
            onChange({ content: e.target.value });
          }}
        />
      </Field>

      <Grid2>
        <Field label="Tamanho">
          <NumInput id={`${id}-fs`} defaultVal={layer.fontSize ?? 14} onCommit={(v) => onChange({ fontSize: v })} suffix="px" />
        </Field>
        <Field label="Altura linha">
          <NumInput id={`${id}-lh`} defaultVal={layer.lineHeight ?? 1.3} step={0.05} onCommit={(v) => onChange({ lineHeight: v })} />
        </Field>
      </Grid2>

      <Field label="Família">
        <FontPicker
          value={layer.fontFamily || 'Inter'}
          onChange={(font) => onChange({ fontFamily: font })}
        />
      </Field>

      <Grid2>
        <Field label="Peso">
          <select
            key={`${id}-fw`}
            style={inputCss}
            defaultValue={layer.fontWeight ?? 'normal'}
            onChange={(e) => onChange({ fontWeight: e.target.value })}
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
            id={`${id}-ls`}
            defaultVal={layer.letterSpacing ?? 0}
            step={0.5}
            onCommit={(v) => onChange({ letterSpacing: v })}
            suffix="px"
          />
        </Field>
      </Grid2>

      <Field label="Cor">
        <ColorSwatch
          id={`${id}-tc`}
          value={layer.color ?? '#000000'}
          onChange={(v) => onChange({ color: v })}
        />
      </Field>

      <Section title="Contraste" icon={<Contrast size={11} />}>
        <Field label="Fundo do texto">
          <button
            onClick={() => onChange({ contrastBackground: !layer.contrastBackground })}
            style={layer.contrastBackground ? btnActive : btnBase}
          >
            {layer.contrastBackground ? 'Ativado' : 'Desativado'}
          </button>
        </Field>
        {layer.contrastBackground && (
          <>
            <Grid2>
              <Field label="Cor fundo">
                <ColorSwatch
                  id={`${id}-cbg`}
                  value={layer.contrastBackgroundColor ?? '#000000'}
                  onChange={(v) => onChange({ contrastBackgroundColor: v })}
                />
              </Field>
              <Field label="Opacidade">
                <NumInput
                  id={`${id}-cbgo`}
                  defaultVal={layer.contrastBackgroundOpacity ?? 0.72}
                  step={0.05}
                  min={0}
                  max={1}
                  onCommit={(v) => onChange({ contrastBackgroundOpacity: v })}
                />
              </Field>
            </Grid2>
            <Field label="Raio">
              <NumInput
                id={`${id}-cbgr`}
                defaultVal={layer.contrastBackgroundRadius ?? 12}
                min={0}
                onCommit={(v) => onChange({ contrastBackgroundRadius: v })}
                suffix="px"
              />
            </Field>
          </>
        )}
      </Section>

      <Field label="Alinhamento">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {alignments.map(({ value, icon }) => (
              <button
                key={value}
                onClick={() => onChange({ textAlign: value })}
                style={currentAlign === value ? btnActive : btnBase}
              >
                {icon}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {verticalAlignments.map(({ value, icon }) => (
              <button
                key={value}
                onClick={() => onChange({ verticalAlign: value })}
                style={currentVAlign === value ? btnActive : btnBase}
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
            onClick={() => onChange({ italic: !isItalic })}
            style={isItalic ? btnActive : btnBase}
            title="Itálico"
          >
            <em style={{ fontStyle: 'italic', fontSize: 12 }}>I</em>
          </button>
          {decorations.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ textDecoration: value })}
              style={currentDecoration === value ? btnActive : btnBase}
              title={value}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}
