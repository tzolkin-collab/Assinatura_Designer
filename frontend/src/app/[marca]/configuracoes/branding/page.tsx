'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Check, X, Loader2, Sparkles } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Toast from '@/components/ui/Toast';
import BrandbookUploaderModal from '@/components/Brandbook/BrandbookUploaderModal';
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
  ignoreAiCostLimit?: boolean;
}

interface LogoSuggestions {
  colors: string[];
  fontRecommendation: string;
}

// Estes rótulos são DICA para quem preenche, não contrato: o backend manda a
// paleta ao artista como `colors.join(', ')` — uma lista sem etiqueta. Nada no
// sistema lê "a cor de índice 3 é a de texto". Por isso a paleta deixou de ser
// presa a esta lista: ela dá nome às primeiras e o resto é livre.
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
  // Eram dois escalares. A tela carregava só primaryFonts[0] e [1] e salvava
  // exatamente dois — enquanto a ingestão do brandbook grava `mergedFonts`, que
  // não tem teto. Um brandbook que rendesse 4 fontes perdia 2 no primeiro save,
  // em silêncio. Agora é a lista inteira.
  const [fonts, setFonts] = useState<string[]>(['Inter', 'SF Mono']);
  const [fonteAberta, setFonteAberta] = useState<number | null>(null);
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
  const [ignoreAiCostLimit, setIgnoreAiCostLimit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [logoSuggestions, setLogoSuggestions] = useState<LogoSuggestions | null>(null);
  const [initialStateStr, setInitialStateStr] = useState<string>('');

  const currentStateStr = JSON.stringify({
    colors,
    primaryFonts: fonts.map((f) => f.trim()).filter(Boolean),
    logoUrl,
    presentationConfig,
    ignoreAiCostLimit,
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
        if (cfg.primaryFonts?.length) {
          setFonts(cfg.primaryFonts);
          cfg.primaryFonts.forEach(loadGoogleFont);
        }
        if (cfg.logoUrl) setLogoUrl(cfg.logoUrl);
        if (cfg.presentationConfig) {
          setPresentationConfig((prev) => ({ ...prev, ...cfg.presentationConfig }));
        }
        if (cfg.ignoreAiCostLimit !== undefined) {
          setIgnoreAiCostLimit(cfg.ignoreAiCostLimit);
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
          // Espelha EXATAMENTE o que o estado vai guardar. Quando o retrato saía
          // do servidor cru e o estado tinha defaults, a tela abria afirmando
          // "alterações não salvas" sem ninguém ter tocado em nada.
          primaryFonts: (cfg.primaryFonts?.length ? cfg.primaryFonts : ['Inter', 'SF Mono']).map((f: string) => f.trim()).filter(Boolean),
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
          ignoreAiCostLimit: cfg.ignoreAiCostLimit ?? false,
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
        primaryFonts: fonts.map((f) => f.trim()).filter(Boolean),
        guidelines: JSON.stringify(guidelinesData),
        logoUrl,
        presentationConfig,
        ignoreAiCostLimit,
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

  // A tela desenhava `COLOR_ROLES.map(...)` — cinco casas fixas — enquanto o
  // banco guarda o que a ingestão do brandbook colocar. A marca assinatura tem
  // 12 cores; sete delas iam para o artista sem que ninguém pudesse ver nem
  // corrigir. Era a explicação direta do "as cores saem erradas".
  const setFonte = (i: number, valor: string) =>
    setFonts((prev) => prev.map((f, idx) => (idx === i ? valor : f)));
  const addFonte = () => setFonts((prev) => [...prev, '']);
  const removeFonte = (i: number) =>
    setFonts((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const addColor = () => setColors((prev) => [...prev, '#000000']);
  const removeColor = (index: number) =>
    setColors((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

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
              primaryFonts: fonts.map((f) => f.trim()).filter(Boolean),
              guidelines: JSON.stringify(guidelinesData),
              logoUrl: result.url,
              presentationConfig,
              ignoreAiCostLimit,
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

    // Era `.slice(0, 5)` porque a grade só tinha cinco casas. Com a paleta livre
    // não há motivo para descartar o que a análise do logo encontrou.
    const newColors = logoSuggestions.colors?.length >= 1
      ? logoSuggestions.colors
      : colors;

    const newPrimaryFont = logoSuggestions.fontRecommendation || fonts[0] || 'Inter';

    setColors(newColors);
    if (logoSuggestions.fontRecommendation) {
      // A recomendação do logo substitui a PRIMEIRA da lista, sem apagar as demais.
      setFonts((prev) => [newPrimaryFont, ...prev.slice(1)]);
      loadGoogleFont(newPrimaryFont);
    }
    setLogoSuggestions(null);

    // Salva diretamente com os novos valores (evita estado desatualizado)
    setSaving(true);
    try {
      await api.put(`/settings/${slug}/config`, {
        colors: newColors,
        primaryFonts: [newPrimaryFont, ...fonts.slice(1)].map((f) => f.trim()).filter(Boolean),
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

  const [isBrandbookModalOpen, setIsBrandbookModalOpen] = useState(false);

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
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="secondary" onClick={() => setIsBrandbookModalOpen(true)}>
              <Sparkles size={14} />
              Importar Brandbook
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save size={14} />
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        }
      />

      <BrandbookUploaderModal
        slug={slug}
        isOpen={isBrandbookModalOpen}
        onClose={() => setIsBrandbookModalOpen(false)}
        onSuccess={() => {
          // Recarrega as configurações atualizadas após ingestão
          api.get<BrandConfig>(`/settings/${slug}/config`).then((cfg) => {
            if (cfg?.colors?.length) setColors(cfg.colors);
            if (cfg?.logoUrl) setLogoUrl(cfg.logoUrl);
            if (cfg?.guidelines) {
              try {
                const parsed = JSON.parse(cfg.guidelines);
                setGuidelinesData((prev) => ({ ...prev, ...parsed }));
              } catch {
                setGuidelinesData((prev) => ({ ...prev, history: cfg.guidelines }));
              }
            }
          });
        }}
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
            {colors.map((cor, i) => (
              <div key={i} className={styles.colorItem}>
                <div className={styles.colorSwatchContainer}>
                  <input
                    type="color"
                    value={cor || '#000000'}
                    onChange={(e) => updateColor(i, e.target.value)}
                    className={styles.colorInput}
                    title={cor}
                  />
                  <span className={styles.swatchLabel}>{cor || '#000000'}</span>
                </div>
                <div className={styles.colorInfo}>
                  <p className={styles.colorLabel}>{COLOR_ROLES[i]?.label ?? `Cor ${i + 1}`}</p>
                  <p className={styles.colorDesc}>{COLOR_ROLES[i]?.desc ?? 'Cor adicional da paleta'}</p>
                  {colors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColor(i)}
                      aria-label={`Remover ${cor}`}
                      style={{ marginTop: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted, #6b7280)', padding: 0 }}
                    >Remover</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addColor}
            style={{ marginTop: 12, border: '1px dashed var(--color-border, rgba(0,0,0,0.2))', background: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
          >+ Adicionar cor</button>
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}>
            A paleta inteira vai para o gerador como um conjunto — os nomes acima são referência para você, não papéis que o sistema aplica.
          </p>
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
              <div className={styles.typeRow} style={{ marginTop: 12 }}>
                <label className={styles.textInput} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={ignoreAiCostLimit}
                    onChange={(e) => setIgnoreAiCostLimit(e.target.checked)}
                  />
                  Ignorar Limite de Custo de IA
                </label>
              </div>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <h3 className={styles.sectionTitle}>Tipografia</h3>
          <div className={styles.typeRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            {fonts.map((fonte, i) => (
              <div key={i} className={styles.inputGroup} style={{ position: 'relative' }}>
                <label className={styles.inputLabel}>
                  {i === 0 ? 'Fonte principal' : `Fonte ${i + 1}`}
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className={styles.textInput}
                    value={fonte}
                    onChange={(e) => { setFonte(i, e.target.value); loadGoogleFont(e.target.value); }}
                    onFocus={() => setFonteAberta(i)}
                    onBlur={() => setFonteAberta((atual) => (atual === i ? null : atual))}
                    style={{ fontFamily: `'${fonte}', sans-serif`, flex: 1 }}
                    placeholder="Ex: Roboto"
                  />
                  {fonts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeFonte(i)}
                      aria-label={`Remover ${fonte || `fonte ${i + 1}`}`}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}
                    >Remover</button>
                  )}
                </div>
                {fonteAberta === i && (
                  <div className={styles.dropdownList} onMouseDown={(e) => e.preventDefault()}>
                    {POPULAR_FONTS.filter(f => f.toLowerCase().includes(fonte.toLowerCase())).map(nome => (
                      <div
                        key={nome}
                        className={styles.dropdownItem}
                        onClick={() => { setFonte(i, nome); loadGoogleFont(nome); setFonteAberta(null); }}
                        style={{
                          fontFamily: `'${nome}', sans-serif`,
                          backgroundColor: fonte === nome ? 'var(--color-bg-secondary)' : 'transparent',
                          color: fonte === nome ? 'var(--color-accent)' : 'inherit',
                          fontWeight: fonte === nome ? 600 : 400,
                        }}
                      >
                        {nome}
                      </div>
                    ))}
                    {POPULAR_FONTS.filter(f => f.toLowerCase().includes(fonte.toLowerCase())).length === 0 && (
                      <div className={styles.dropdownItem} style={{ color: 'var(--color-text-tertiary)' }}>
                        Nenhuma na lista — digitando o nome exato de uma Google Font também funciona
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addFonte}
            style={{ marginTop: 12, border: '1px dashed var(--color-border, rgba(0,0,0,0.2))', background: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
          >+ Adicionar fonte</button>
          {/* O gerador monta o href do Google Fonts com `.slice(0, 4)`. Dizer isso
              é melhor do que deixar a quinta fonte sumir sem explicação. */}
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted, #6b7280)' }}>
            {fonts.length > 4
              ? `O gerador carrega as 4 primeiras — as outras ${fonts.length - 4} ficam guardadas, mas não são aplicadas.`
              : 'Precisa ser o nome exato de uma Google Font. Arquivo próprio (.ttf) ainda não é suportado.'}
          </p>
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
