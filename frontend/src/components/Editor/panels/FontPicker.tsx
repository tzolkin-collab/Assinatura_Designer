'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { POPULAR_GOOGLE_FONTS, loadGoogleFont } from '@/lib/googleFonts';

interface Props {
  value: string;
  onChange: (fontFamily: string) => void;
  style?: React.CSSProperties;
}

export default function FontPicker({ value, onChange, style }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Load the current font if not loaded
  useEffect(() => {
    if (value) {
      loadGoogleFont(value);
    }
  }, [value]);

  const filteredFonts = POPULAR_GOOGLE_FONTS.filter(f => 
    f.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', ...style }}>
      <button
        onClick={() => { setOpen(!open); setSearch(''); }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          color: 'var(--color-text)',
          cursor: 'pointer',
          fontFamily: value ? `"${value}", sans-serif` : 'inherit',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || 'Inter'}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 4,
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 250,
        }}>
          <input
            autoFocus
            type="text"
            placeholder="Buscar fonte..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              margin: 4,
              padding: '6px 8px',
              fontSize: 12,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              outline: 'none',
              color: 'var(--color-text)',
            }}
          />
          <div style={{ overflowY: 'auto', flex: 1, padding: 4 }}>
            {filteredFonts.length === 0 ? (
              <div style={{ padding: 8, fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                Nenhuma fonte encontrada
              </div>
            ) : (
              filteredFonts.map((font) => (
                <button
                  key={font}
                  onClick={() => {
                    onChange(font);
                    setOpen(false);
                  }}
                  onMouseEnter={() => loadGoogleFont(font)} // pre-load on hover
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'var(--color-text)',
                  }}
                >
                  <span style={{ fontFamily: `"${font}", sans-serif`, fontSize: 13 }}>
                    {font}
                  </span>
                  {value === font && <Check size={12} color="var(--color-accent)" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
