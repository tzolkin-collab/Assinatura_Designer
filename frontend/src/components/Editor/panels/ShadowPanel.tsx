'use client';

import { Sun } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Grid2, Field, NumInput, ColorSwatch } from './shared';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function ShadowPanel({ layer, onChange }: Props) {
  const id = layer.id;

  return (
    <Section title="Sombra" icon={<Sun size={11} />}>
      <Field label="Cor">
        <ColorSwatch
          id={`${id}-shc`}
          value={layer.shadowColor ?? '#00000040'}
          onChange={(v) => onChange({ shadowColor: v })}
        />
      </Field>
      <Grid2>
        <Field label="Blur">
          <NumInput
            id={`${id}-shb`}
            defaultVal={layer.shadowBlur ?? 0}
            onCommit={(v) => onChange({ shadowBlur: v })}
            suffix="px"
            min={0}
          />
        </Field>
        <Field label="Offset X">
          <NumInput
            id={`${id}-shx`}
            defaultVal={layer.shadowOffsetX ?? 0}
            onCommit={(v) => onChange({ shadowOffsetX: v })}
            suffix="px"
          />
        </Field>
        <Field label="Offset Y">
          <NumInput
            id={`${id}-shy`}
            defaultVal={layer.shadowOffsetY ?? 0}
            onCommit={(v) => onChange({ shadowOffsetY: v })}
            suffix="px"
          />
        </Field>
      </Grid2>
    </Section>
  );
}
