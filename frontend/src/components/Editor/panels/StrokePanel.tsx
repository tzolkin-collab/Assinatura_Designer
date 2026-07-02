'use client';

import { PenTool } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, ColorSwatch, inputCss } from './shared';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function StrokePanel({ layer, onChange }: Props) {
  const id = layer.id;

  return (
    <Section title="Traçado" icon={<PenTool size={11} />}>
      <Field label="Cor">
        <ColorSwatch
          id={`${id}-bc`}
          value={layer.borderColor ?? '#000000'}
          onChange={(v) => onChange({ borderColor: v })}
        />
      </Field>
      <Grid2>
        <Field label="Espessura">
          <NumInput
            id={`${id}-bw`}
            defaultVal={layer.borderWidth ?? 0}
            onCommit={(v) => onChange({ borderWidth: v })}
            suffix="px"
            min={0}
          />
        </Field>
        <Field label="Estilo">
          <select
            key={`${id}-bs`}
            style={inputCss}
            defaultValue={layer.strokeStyle ?? 'solid'}
            onChange={(e) =>
              onChange({ strokeStyle: e.target.value as Layer['strokeStyle'] })
            }
          >
            <option value="solid">Sólido</option>
            <option value="dashed">Tracejado</option>
            <option value="dotted">Pontilhado</option>
          </select>
        </Field>
      </Grid2>
    </Section>
  );
}
