'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Check, X, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Toast from '@/components/ui/Toast';
import styles from './branding.module.css';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';

interface PresentationConfig {
  autoMode?: boolean;
  requirePaletteConfirmation?: boolean;
  paletteApproved?: string[];
  paletteDirection?: string;
  paletteNotes?: string;
  visualVibe?: string;
  boldness?: 'safe' | 'balanced' | 'bold';
  photoPreference?: 'minimal' | 'balanced' | 'high';
  imageryStyle?: string;
  allowGeneratedGraphics?: boolean;
  allowSvgLayouts?: boolean;
  notes?: string;
}

interface BrandConfig {
  colors: string[];
  primaryFonts: string[];
  guidelines: string;
  logoUrl?: string;
  presentationConfig?: PresentationConfig;
}

interface LogoSuggestions {
  colors: string[];
  fontRecommendation: string;
}

const COLOR_ROLES = [
  { label: 'Cor Primária', desc: 'Direção principal da marca' },
  { label: 'Cor Secundária', desc: 'Apoio e contraste' },
  { label: 'Cor de Superfície', desc: 'Cards, caixas e áreas de respiro' },
  { label: 'Cor de Texto', desc: 'Base de leitura e contraste' },
  { label: 'Cor de Destaque', desc: 'CTA, badges e pontos de energia visual' },
];

const POPULAR_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Oswald', 'Raleway', 'Poppins', 'Playfair Display', 'Merriweather',
  'Ubuntu', 'Nunito', 'Rubik', 'Bebas Neue', 'Titillium Web',
];

export default function BrandingPage() {
  const params = useParams();
  const slug = params.marca as string;

  const [colors, setColors] = useState(['#171717', '#ffffff', '#f4f4f5', '#666666', '#0070f3']);
  const [primaryFont, setPrimaryFont] = useState('Inter');
  const [secondaryFont, setSecondaryFont] = useState('SF Mono');
  const [showPrimaryFonts, setShowPrimaryFonts] = useState(false);
  const [showSecondaryFonts, setShowSecondaryFonts] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [guidelinesData, setGuidelinesData] = useState({
    name: 'Nome da Marca',
    history: 'Resumo sobre o que a marca faz e sua essência',
    website: 'https://',
    instagram: '@',
    style: 'Minimalista e limpo',
    restrictions: 'Sem emojis exagerados',
  });
  const [logoUrl, setLogoUrl] = useState('');
  const [presentationConfig, setPresentationConfig] = useState<PresentationConfig>({
    autoMode: false,
    requirePaletteConfirmation: true,
    visualVibe: 'Sofisticada e clara',
    boldness: 'balanced',
    photoPreference: 'balanced',
    allowGeneratedGraphics: true,
    allowSvgLayouts: true,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [logoSuggestions, setLogoSuggestions] = useState<LogoSuggestions | null>(null);
  const [initialStateStr, setInitialStateStr] = useState<string>('');

  const currentStateStr = JSON.stringify({
    colors,
    primaryFonts: [primaryFont, secondaryFont].filter(Boolean),
    logoUrl,
    presentationConfig,
    guidelinesData: JSON.stringify(guidelinesData)
  });
  
  const isDirty = initialStateStr !== '' && currentStateStr !== initialStateStr;

  const loadGoogleFont = (fontName: string) => {
    if (!fontName || typeof window === 'undefined') return;
    const formattedName = fontName.trim().replace(/\s+/g, '+');
    const url = `https://fonts.googleapis.com/css2?family=${formattedName}:wght@400;500;600;700&display=swap`;
    if (!document.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
  };

  useEffect(() => {
    const families = POPULAR_FONTS.map(f => `family=${f.replace(/\s+/g, '+')}:wght@400;500;600`).join('&');
    const preloadUrl = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    if (!document.querySelector(`link[href="${preloadUrl}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = preloadUrl;
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    api.get<BrandConfig>(`/settings/${slug}/config`)
      .then((cfg) => {
        if (!cfg) return;
        if (cfg.colors?.length) setColors(cfg.colors);
        if (cfg.primaryFonts?.[0]) { setPrimaryFont(cfg.primaryFonts[0]); loadGoogleFont(cfg.primaryFonts[0]); }
        if (cfg.primaryFonts?.[1]) { setSecondaryFont(cfg.primaryFonts[1]); loadGoogleFont(cfg.primaryFonts[1]); }
        if (cfg.logoUrl) setLogoUrl(cfg.logoUrl);
        if (cfg.presentationConfig) {
          setPresentationConfig((prev) => ({ ...prev, ...cfg.presentationConfig }));
        }
        if (cfg.guidelines) {
          try {
            const parsed = JSON.parse(cfg.guidelines);
            setGuidelinesData((prev) => ({ ...prev, ...parsed }));
          } catch {
            setGuidelinesData((prev) => ({ ...prev, history: cfg.guidelines }));
          }
        }
        setInitialStateStr(JSON.stringify({
          colors: cfg.colors || ['#171717', '#ffffff', '#f4f4f5', '#666666', '#0070f3'],
          primaryFonts: cfg.primaryFonts || ['Inter', 'SF Mono'],
          logoUrl: cfg.logoUrl || '',
          presentationConfig: cfg.presentationConfig || {
            autoMode: false,
            requirePaletteConfirmation: true,
            visualVibe: 'Sofisticada e clara',
            boldness: 'balanced',
            photoPreference: 'balanced',
            allowGeneratedGraphics: true,
            allowSvgLayouts: true,
          },
          guidelinesData: cfg.guidelines || JSON.stringify({
            name: 'Nome da Marca',
            history: 'Resumo sobre o que a marca faz e sua essência',
            website: 'https://',
            instagram: '@',
            style: 'Minimalista e limpo',
            restrictions: 'Sem emojis exagerados',
          })
        }));
      })
      .catch(() => {});
  }, [slug]);

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      await api.put(`/settings/${slug}/config`, {
        colors,
        primaryFonts: [primaryFont, secondaryFont].filter(Boolean),
        guidelines: JSON.stringify(guidelinesData),
        logoUrl,
        presentationConfig,
      });
      setInitialStateStr(currentStateStr);
      setToast({ message: 'Configurações de branding salvas com sucesso!', type: 'success' });
    } catch {
      setToast({ message: 'Erro ao salvar configurações. Tente novamente.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const updateColor = (index: number, value: string) => {
    setColors((prev) => prev.map((c, i) => (i === index ? value : c)));
  };

  const processLogoFile = (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setToast({ message: 'Arquivo muito grande. Máximo 8MB.', type: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const [header, data] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || file.type;

      setLogoUrl(dataUrl);
      setLogoSuggestions(null);

      // Extração roda imediatamente, sem depender do upload R2
      // Todos os tipos aceitos pelo backend são normalizados antes do Gemini
      const canExtract = true;
      if (canExtract) {
        setExtracting(true);
        api.post<LogoSuggestions>(`/ai/${slug}/extract-from-logo`, { logoData: data, mimeType })
          .then((suggestions) => {
            if (suggestions) setLogoSuggestions(suggestions);
          })
          .catch(() => {
            setToast({ message: 'Não foi possível analisar o logo. Tente outro formato.', type: 'error' });
          })
          .finally(() => setExtracting(false));
      }

      api.post<{ url: string }>('/upload/logo', { data, mimeType })
        .then(async (result) => {
          setLogoUrl(result.url);
          // Salva automaticamente o logo na configuração da marca
          try {
            await api.put(`/settings/${slug}/config`, {
              colors,
              primaryFonts: [primaryFont, secondaryFont].filter(Boolean),
              guidelines: JSON.stringify(guidelinesData),
              logoUrl: result.url,
              presentationConfig,
            });
            setToast({ message: 'Logo salvo com sucesso!', type: 'success' });
          } catch {
            setToast({ message: 'Logo enviado, mas erro ao salvar na marca.', type: 'error' });
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof ApiError
            ? error.message
            : 'Logo mantido localmente, mas não foi possível enviar para o armazenamento.';
          setToast({ message, type: 'error' });
        });
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processLogoFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processLogoFile(file);
  };

  const applyLogoSuggestions = async () => {
    if (!logoSuggestions) return;

    const newColors = logoSuggestions.colors?.length >= 1
      ? logoSuggestions.colors.slice(0, 5)
      : colors;

    const newPrimaryFont = logoSuggestions.fontRecommendation || primaryFont;

    setColors(newColors);
    if (logoSuggestions.fontRecommendation) {
      setPrimaryFont(newPrimaryFont);
      loadGoogleFont(newPrimaryFont);
    }
    setLogoSuggestions(null);

    // Salva diretamente com os novos valores (evita estado desatualizado)
    setSaving(true);
    try {
      await api.put(`/settings/${slug}/config`, {
        colors: newColors,
        primaryFonts: [newPrimaryFont, secondaryFont].filter(Boolean),
        guidelines: JSON.stringify(guidelinesData),
        logoUrl,
        presentationConfig: {
          ...presentationConfig,
          paletteApproved: newColors,
        },
      });
      setInitialStateStr(currentStateStr);
      setToast({ message: 'Paleta e fonte atualizadas com base no logo!', type: 'success' });
    } catch {
      setToast({ message: 'Erro ao salvar configurações. Tente novamente.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Branding"
        description="Identidade visual da marca — cores, tipografia e diretrizes."
        actions={
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className={styles.grid}>
        <Card padding="md">
          <h3 className={styles.sectionTitle}>Logotipo</h3>
          <label 
            className={`${styles.uploadArea} ${isDragging ? styles.uploadAreaDragging : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.webp,.heic,.heif,.gif,.avif,image/*"
              style={{ display: 'none' }}
              onChange={handleLogoUpload}
            />
            {logoUrl ? (
              <div className={styles.logoPreview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="Logotipo da marca" className={styles.logoImg} />
                <p>Clique para alterar a imagem</p>
              </div>
            ) : (
              <>
                <p>Arraste ou clique para enviar o logotipo da marca</p>
                <span className={styles.uploadHint}>PNG, JPEG, WebP, SVG, HEIC, GIF — máx 8MB</span>
              </>
            )}
          </label>

          {extracting && (
            <div className={styles.extractingBanner}>
              <Loader2 size={14} className={styles.spinIcon} />
              <span>Analisando logo com IA...</span>
            </div>
          )}

        </Card>

        <Card padding="md">
          <h3 className={styles.sectionTitle}>Paleta de Cores</h3>
          <div className={styles.colorGrid}>
            {COLOR_ROLES.map((role, i) => (
              <div key={i} className={styles.colorItem}>
                <div className={styles.colorSwatchContainer}>
                  <input
                    type="color"
                    value={colors[i] || '#000000'}
                    onChange={(e) => updateColor(i, e.target.value)}
                    className={styles.colorInput}
                    title={colors[i]}
                  />
                  <span className={styles.swatchLabel}>{colors[i] || '#000000'}</span>
                </div>
                <div className={styles.colorInfo}>
                  <p className={styles.colorLabel}>{role.label}</p>
                  <p className={styles.colorDesc}>{role.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card padding="md">
          <h3 className={styles.sectionTitle}>Direção de Geração</h3>
          <div className={styles.guidelinesGrid}>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Vibe Visual</label>
              <input
                className={styles.textInput}
                value={presentationConfig.visualVibe ?? ''}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, visualVibe: e.target.value }))}
                placeholder="Ex: Editorial premium com contraste alto"
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Direção de Paleta</label>
              <input
                className={styles.textInput}
                value={presentationConfig.paletteDirection ?? ''}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, paletteDirection: e.target.value }))}
                placeholder="Ex: Tons quentes, ousados e sofisticados"
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Nível de Ousadia</label>
              <select
                className={styles.textInput}
                value={presentationConfig.boldness ?? 'balanced'}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, boldness: e.target.value as PresentationConfig['boldness'] }))}
              >
                <option value="safe">Seguro</option>
                <option value="balanced">Equilibrado</option>
                <option value="bold">Ousado</option>
              </select>
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Uso de Fotos</label>
              <select
                className={styles.textInput}
                value={presentationConfig.photoPreference ?? 'balanced'}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, photoPreference: e.target.value as PresentationConfig['photoPreference'] }))}
              >
                <option value="minimal">Mínimo</option>
                <option value="balanced">Equilibrado</option>
                <option value="high">Alto</option>
              </select>
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Estilo de Imagem</label>
              <input
                className={styles.textInput}
                value={presentationConfig.imageryStyle ?? ''}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, imageryStyle: e.target.value }))}
                placeholder="Ex: Fotografia lifestyle com luz natural"
              />
            </div>
            <div className={styles.inputGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.inputLabel}>Notas para a Paleta</label>
              <input
                className={styles.textInput}
                value={presentationConfig.paletteNotes ?? ''}
                onChange={(e) => setPresentationConfig(prev => ({ ...prev, paletteNotes: e.target.value }))}
                placeholder="Ex: evitar tons pastéis e manter contraste premium"
              />
            </div>
            <div className={styles.inputGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.inputLabel}>Preferências Operacionais</label>
              <div className={styles.typeRow}>
                <label className={styles.textInput} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={presentationConfig.requirePaletteConfirmation !== false}
                    onChange={(e) => setPresentationConfig(prev => ({ ...prev, requirePaletteConfirmation: e.target.checked }))}
                  />
                  Confirmar paleta antes de gerar
                </label>
                <label className={styles.textInput} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={presentationConfig.autoMode === true}
                    onChange={(e) => setPresentationConfig(prev => ({ ...prev, autoMode: e.target.checked }))}
                  />
                  Modo automático por padrão
                </label>
              </div>
              <div className={styles.typeRow} style={{ marginTop: 12 }}>
                <label className={styles.textInput} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={presentationConfig.allowGeneratedGraphics !== false}
                    onChange={(e) => setPresentationConfig(prev => ({ ...prev, allowGeneratedGraphics: e.target.checked }))}
                  />
                  Permitir grafismos gerados
                </label>
                <label className={styles.textInput} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={presentationConfig.allowSvgLayouts !== false}
                    onChange={(e) => setPresentationConfig(prev => ({ ...prev, allowSvgLayouts: e.target.checked }))}
                  />
                  Permitir composições SVG/CSS
                </label>
              </div>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <h3 className={styles.sectionTitle}>Tipografia</h3>
          <div className={styles.typeRow}>
            <div className={styles.inputGroup} style={{ position: 'relative' }}>
              <label className={styles.inputLabel}>Fonte Principal</label>
              <input
                className={styles.textInput}
                value={primaryFont}
                onChange={(e) => { setPrimaryFont(e.target.value); loadGoogleFont(e.target.value); }}
                onFocus={() => setShowPrimaryFonts(true)}
                onBlur={() => setShowPrimaryFonts(false)}
                style={{ fontFamily: `'${primaryFont}', sans-serif` }}
                placeholder="Ex: Roboto"
              />
              {showPrimaryFonts && (
                <div className={styles.dropdownList} onMouseDown={(e) => e.preventDefault()}>
                  {POPULAR_FONTS.filter(f => f.toLowerCase().includes(primaryFont.toLowerCase())).map(font => (
                    <div
                      key={font}
                      className={styles.dropdownItem}
                      onClick={() => { setPrimaryFont(font); loadGoogleFont(font); setShowPrimaryFonts(false); }}
                      style={{
                        fontFamily: `'${font}', sans-serif`,
                        backgroundColor: primaryFont === font ? 'var(--color-bg-secondary)' : 'transparent',
                        color: primaryFont === font ? 'var(--color-accent)' : 'inherit',
                        fontWeight: primaryFont === font ? 600 : 400,
                      }}
                    >
                      {font}
                    </div>
                  ))}
                  {POPULAR_FONTS.filter(f => f.toLowerCase().includes(primaryFont.toLowerCase())).length === 0 && (
                    <div className={styles.dropdownItem} style={{ color: 'var(--color-text-tertiary)' }}>Nenhuma fonte encontrada</div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.inputGroup} style={{ position: 'relative' }}>
              <label className={styles.inputLabel}>Fonte Secundária</label>
              <input
                className={styles.textInput}
                value={secondaryFont}
                onChange={(e) => { setSecondaryFont(e.target.value); loadGoogleFont(e.target.value); }}
                onFocus={() => setShowSecondaryFonts(true)}
                onBlur={() => setShowSecondaryFonts(false)}
                style={{ fontFamily: `'${secondaryFont}', monospace` }}
                placeholder="Ex: Open Sans"
              />
              {showSecondaryFonts && (
                <div className={styles.dropdownList} onMouseDown={(e) => e.preventDefault()}>
                  {POPULAR_FONTS.filter(f => f.toLowerCase().includes(secondaryFont.toLowerCase())).map(font => (
                    <div
                      key={font}
                      className={styles.dropdownItem}
                      onClick={() => { setSecondaryFont(font); loadGoogleFont(font); setShowSecondaryFonts(false); }}
                      style={{
                        fontFamily: `'${font}', sans-serif`,
                        backgroundColor: secondaryFont === font ? 'var(--color-bg-secondary)' : 'transparent',
                        color: secondaryFont === font ? 'var(--color-accent)' : 'inherit',
                        fontWeight: secondaryFont === font ? 600 : 400,
                      }}
                    >
                      {font}
                    </div>
                  ))}
                  {POPULAR_FONTS.filter(f => f.toLowerCase().includes(secondaryFont.toLowerCase())).length === 0 && (
                    <div className={styles.dropdownItem} style={{ color: 'var(--color-text-tertiary)' }}>Nenhuma fonte encontrada</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card padding="md">
          <h3 className={styles.sectionTitle}>Identidade e Diretrizes da Marca</h3>
          <div className={styles.guidelinesGrid}>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Nome Comercial</label>
              <input
                className={styles.textInput}
                value={guidelinesData.name}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Apple, Nike, Minha Loja"
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Instagram (Arroba)</label>
              <input
                className={styles.textInput}
                value={guidelinesData.instagram}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, instagram: e.target.value }))}
                placeholder="Ex: @minhamarca"
              />
            </div>
            <div className={styles.inputGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.inputLabel}>História e Essência</label>
              <textarea
                className={styles.textarea}
                rows={3}
                value={guidelinesData.history}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, history: e.target.value }))}
                placeholder="Ex: Somos uma startup focada em tecnologia verde..."
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Website</label>
              <input
                className={styles.textInput}
                value={guidelinesData.website}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, website: e.target.value }))}
                placeholder="Ex: https://meusite.com.br"
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Estilo Visual</label>
              <input
                className={styles.textInput}
                value={guidelinesData.style}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, style: e.target.value }))}
                placeholder="Ex: Minimalista, 3D, Flat design"
              />
            </div>
            <div className={styles.inputGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.inputLabel}>Restrições (O que NÃO fazer)</label>
              <input
                className={styles.textInput}
                value={guidelinesData.restrictions}
                onChange={(e) => setGuidelinesData(prev => ({ ...prev, restrictions: e.target.value }))}
                placeholder="Ex: Não usar fontes serifadas, sem gradientes"
              />
            </div>
          </div>
        </Card>
      </div>

      {isDirty && (
        <div className={styles.stickySaveBar}>
          <div className={styles.stickySaveBarText}>
            <span className={styles.stickySaveBarTitle}>Alterações não salvas</span>
            <span className={styles.stickySaveBarDesc}>Você tem mudanças pendentes.</span>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save size={16} />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      )}

      {/* Modal via portal — escapa do stacking context do <main> */}
      {logoSuggestions && !extracting && createPortal(
        <div className={styles.modalOverlay} onClick={() => setLogoSuggestions(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleRow}>
                <Check size={16} className={styles.modalCheckIcon} />
                <h2 className={styles.modalTitle}>Branding extraído do logo</h2>
              </div>
              <button className={styles.modalClose} onClick={() => setLogoSuggestions(null)}>
                <X size={18} />
              </button>
            </div>

            <p className={styles.modalSubtitle}>
              Seu logo foi salvo! Deseja aplicar as cores e a fonte extraídas dele à sua marca?
            </p>

            {logoSuggestions.colors?.length > 0 && (
              <div className={styles.modalSection}>
                <p className={styles.modalSectionLabel}>Paleta de cores extraída</p>
                <div className={styles.modalSwatches}>
                  {logoSuggestions.colors.slice(0, 5).map((color, i) => (
                    <div key={i} className={styles.modalSwatch} style={{ backgroundColor: color }}>
                      <span className={styles.modalSwatchHex}>{color}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {logoSuggestions.fontRecommendation && (
              <div className={styles.modalSection}>
                <p className={styles.modalSectionLabel}>Fonte recomendada</p>
                <p className={styles.modalSectionValue} style={{ fontFamily: `'${logoSuggestions.fontRecommendation}', sans-serif`, fontSize: 15 }}>
                  {logoSuggestions.fontRecommendation}
                </p>
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setLogoSuggestions(null)}>
                Não, manter como estava
              </button>
              <Button size="sm" onClick={applyLogoSuggestions} disabled={saving}>
                <Check size={14} />
                {saving ? 'Aplicando...' : 'Aplicar Sugestões'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
