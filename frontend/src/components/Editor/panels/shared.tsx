'use client';

import React from 'react';

export const inputCss: React.CSSProperties = {
  width: '100%',
  padding: '5px 7px',
  fontSize: 12,
  color: 'var(--color-text)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingBottom: 5,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {icon && (
          <span style={{ color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center' }}>
            {icon}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            flex: 1,
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: 1 }}>{label}</span>
      {children}
    </div>
  );
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {children}
    </div>
  );
}

export function NumInput({
  id,
  defaultVal,
  onCommit,
  step,
  suffix,
  min,
  max,
}: {
  id: string;
  defaultVal: number;
  onCommit: (v: number) => void;
  step?: number;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        key={id}
        type="number"
        style={{ ...inputCss, paddingRight: suffix ? 24 : undefined }}
        defaultValue={defaultVal}
        step={step}
        min={min}
        max={max}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

export function ColorSwatch({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '4px 7px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      <label
        style={{
          position: 'relative',
          width: 14,
          height: 14,
          borderRadius: 3,
          background: value,
          border: '1px solid rgba(0,0,0,0.12)',
          cursor: 'pointer',
          flexShrink: 0,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <input
          key={id}
          type="color"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          style={{
            opacity: 0,
            position: 'absolute',
            inset: 0,
            cursor: 'pointer',
            width: '100%',
            height: '100%',
            padding: 0,
            border: 'none',
          }}
        />
      </label>
      <span
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-secondary)',
          flex: 1,
          textTransform: 'uppercase',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function OpacitySlider({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const displayValue = Math.round(value * 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        key={id}
        type="range"
        min={0}
        max={100}
        value={displayValue}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(v / 100);
        }}
        style={{ flex: 1, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
      />
      <span
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-secondary)',
          minWidth: 28,
          textAlign: 'right',
        }}
      >
        {displayValue}%
      </span>
    </div>
  );
}
