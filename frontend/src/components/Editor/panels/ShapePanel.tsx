'use client';

import { Square } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, ColorSwatch, inputCss } from './shared';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function ShapePanel({ layer, onChange }: Props) {
  const id = layer.id;
  const gradType = layer.gradientType ?? 'none';

  return (
    <Section title="Objeto" icon={<Square size={11} />}>
      <Field label="Preenchimento">
        <ColorSwatch
          id={`${id}-sc`}
          value={layer.color ?? '#cccccc'}
          onChange={(v) => onChange({ color: v })}
        />
      </Field>

      <Field label="Arredondamento">
        <NumInput
          id={`${id}-br`}
          defaultVal={layer.borderRadius ?? 0}
          onCommit={(v) => onChange({ borderRadius: v })}
          suffix="px"
          min={0}
        />
      </Field>

      <Field label="Gradiente">
        <select
          key={`${id}-gt`}
          style={inputCss}
          defaultValue={gradType}
          onChange={(e) =>
            onChange({ gradientType: e.target.value as Layer['gradientType'] })
          }
        >
          <option value="none">Nenhum</option>
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
      </Field>

      {gradType !== 'none' && (
        <Grid2>
          <Field label="Cor 2">
            <ColorSwatch
              id={`${id}-gc2`}
              value={layer.gradientColor2 ?? '#ffffff'}
              onChange={(v) => onChange({ gradientColor2: v })}
            />
          </Field>
          {gradType === 'linear' && (
            <Field label="Ângulo">
              <NumInput
                id={`${id}-ga`}
                defaultVal={layer.gradientAngle ?? 90}
                onCommit={(v) => onChange({ gradientAngle: v })}
                suffix="°"
              />
            </Field>
          )}
        </Grid2>
      )}
    </Section>
  );
}
