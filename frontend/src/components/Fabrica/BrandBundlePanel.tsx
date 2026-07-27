'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Image as ImageIcon, Type, Palette } from 'lucide-react';
import { api } from '@/lib/api';
import s from './BrandBundlePanel.module.css';

interface BrandConfig {
  colors?: string[];
  primaryFonts?: string[];
  guidelines?: string;
  logoUrl?: string;
}

interface Asset {
  id: string;
  name: string;
  url: string;
  fileType: string;
  source?: string;
  tags?: string[];
}

interface BrandBundlePanelProps {
  slug: string;
}

export default function BrandBundlePanel({ slug }: BrandBundlePanelProps) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<BrandConfig | null>(null);
  const [brandbookAssets, setBrandbookAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  // loading separado de loaded: sem isto, a primeira abertura marcava loaded=true
  // antes do fetch voltar e o estado vazio ("Adicione um Brandbook") piscava
  // mesmo pra marca com bundle completo.
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);

    Promise.allSettled([
      api.get<BrandConfig>(`/settings/${slug}/config`),
      api.get<Asset[]>(`/brands/${slug}/assets`),
    ]).then(([cfgRes, assetsRes]) => {
      if (cfgRes.status === 'fulfilled') {
        setConfig(cfgRes.value);
      }
      if (assetsRes.status === 'fulfilled') {
        const all = Array.isArray(assetsRes.value) ? assetsRes.value : [];
        setBrandbookAssets(
          all.filter((a) => a.source === 'brandbook' || a.source === 'branding').slice(0, 12),
        );
      }
    }).finally(() => {
      setLoaded(true);
      setLoading(false);
    });
  }, [open, loaded, slug]);

  const colors = config?.colors ?? [];
  const fonts = config?.primaryFonts ?? [];
  const logoUrl = config?.logoUrl;
  const hasBundleData = logoUrl || colors.length > 0 || fonts.length > 0 || brandbookAssets.length > 0;

  const guidelinePreview = (() => {
    if (!config?.guidelines) return null;
    try {
      const parsed = JSON.parse(config.guidelines) as Record<string, string>;
      return parsed.history ?? parsed.style ?? null;
    } catch {
      return config.guidelines.slice(0, 120) || null;
    }
  })();

  return (
    <div className={s.wrapper}>
      <button
        className={`${s.trigger} ${open ? s.triggerOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
        title="Ver referências de marca usadas pela IA"
      >
        <Sparkles size={12} className={s.triggerIcon} />
        <span className={s.triggerLabel}>Referências de Marca</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className={s.panel}>
          {loading ? (
            <p className={s.loading}>Carregando...</p>
          ) : !hasBundleData ? (
            <div className={s.empty}>
              <Sparkles size={16} className={s.emptyIcon} />
              <p className={s.emptyText}>
                Adicione um Brandbook em{' '}
                <a href={`/${slug}/configuracoes/midia`} className={s.emptyLink}>
                  Configurações › Mídia
                </a>{' '}
                para a IA usar as referências da marca.
              </p>
            </div>
          ) : (
            <div className={s.content}>

              {logoUrl && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <ImageIcon size={11} />
                    <span>Logo</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="Logo da marca" className={s.logo} />
                </div>
              )}

              {colors.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <Palette size={11} />
                    <span>Paleta</span>
                  </div>
                  <div className={s.palette}>
                    {colors.slice(0, 5).map((c, i) => (
                      <div key={i} className={s.swatch} title={c}>
                        <div className={s.swatchColor} style={{ background: c }} />
                        <span className={s.swatchHex}>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {fonts.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <Type size={11} />
                    <span>Tipografia</span>
                  </div>
                  <div className={s.fonts}>
                    {fonts.filter(Boolean).map((f, i) => (
                      <span key={i} className={s.fontChip}>{f}</span>
                    ))}
                  </div>
                </div>
              )}

              {guidelinePreview && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <span>Diretrizes</span>
                  </div>
                  <p className={s.guideline}>{guidelinePreview}</p>
                </div>
              )}

              {brandbookAssets.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <span>Assets ({brandbookAssets.length})</span>
                  </div>
                  <div className={s.assetGrid}>
                    {brandbookAssets.map((a) => (
                      <div key={a.id} className={s.assetThumb} title={a.name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt={a.name} className={s.assetImg} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
  );
}

