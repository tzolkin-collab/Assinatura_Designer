'use client';

import { Move, Lock, Unlock } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, OpacitySlider } from './shared';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function TransformPanel({ layer, onChange }: Props) {
  const id = layer.id;

  const handleDimensionChange = (axis: 'width' | 'height', val: number) => {
    if (!layer.lockAspectRatio) {
      onChange({ [axis]: val });
      return;
    }
    const ratio = layer.width / layer.height;
    if (axis === 'width') {
      onChange({ width: val, height: Math.round(val / ratio) });
    } else {
      onChange({ height: val, width: Math.round(val * ratio) });
    }
  };

  return (
    <Section title="Transformar" icon={<Move size={11} />}>
      <Grid2>
        <Field label="X">
          <NumInput id={`${id}-x`} defaultVal={layer.x} onCommit={(v) => onChange({ x: v })} suffix="px" />
        </Field>
        <Field label="Y">
          <NumInput id={`${id}-y`} defaultVal={layer.y} onCommit={(v) => onChange({ y: v })} suffix="px" />
        </Field>
        <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', alignItems: 'center' }}>
          <Field label="Largura">
            <NumInput id={`${id}-w`} defaultVal={layer.width} onCommit={(v) => handleDimensionChange('width', v)} suffix="px" />
          </Field>
          <button 
            onClick={() => onChange({ lockAspectRatio: !layer.lockAspectRatio })}
            title="Travar Proporção"
            style={{ 
              background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer',
              color: layer.lockAspectRatio ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              marginTop: 16, padding: '6px 8px', borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            {layer.lockAspectRatio ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <Field label="Altura">
            <NumInput id={`${id}-h`} defaultVal={layer.height} onCommit={(v) => handleDimensionChange('height', v)} suffix="px" />
          </Field>
        </div>
        <Field label="Rotação">
          <NumInput
            id={`${id}-rot`}
            defaultVal={layer.rotation ?? 0}
            onCommit={(v) => onChange({ rotation: v })}
            suffix="°"
            min={-360}
            max={360}
          />
        </Field>
        <Field label="Z-Index">
          <NumInput id={`${id}-zi`} defaultVal={layer.zIndex ?? 0} onCommit={(v) => onChange({ zIndex: v })} />
        </Field>
      </Grid2>
      <Field label="Opacidade">
        <OpacitySlider
          id={`${id}-op`}
          value={layer.opacity ?? 1}
          onChange={(v) => onChange({ opacity: v })}
        />
      </Field>
    </Section>
  );
}
