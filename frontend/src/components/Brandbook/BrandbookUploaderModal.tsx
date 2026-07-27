'use client';

import React, { useState, useRef } from 'react';
import { Upload, X, CheckCircle, Sparkles, FileText, Image as ImageIcon, AlertCircle, RefreshCw, Layers, Palette, FileImage } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { api } from '@/lib/api';
import styles from './BrandbookUploaderModal.module.css';

export interface IngestResultData {
  guidelines: string;
  colors: string[];
  primaryFonts: string[];
  svgsIndexed: {
    logotypes: number;
    graphicElements: number;
    illustrations: number;
    total: number;
  };
  logoNeedsConfirmation: boolean;
  detectedLogoUrl?: string | null;
  currentLogoUrl?: string | null;
}

export interface BrandbookUploaderModalProps {
  slug: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (data: IngestResultData) => void;
}

export default function BrandbookUploaderModal({
  slug,
  isOpen,
  onClose,
  onSuccess,
}: BrandbookUploaderModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [stepText, setStepText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResultData | null>(null);
  const [updatingLogo, setUpdatingLogo] = useState(false);
  const [logoUpdated, setLogoUpdated] = useState(false);

  const [ingestMode, setIngestMode] = useState<'files' | 'canva'>('files');
  const [canvaUrl, setCanvaUrl] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
      setError('');
    }
  };

  const extractFilesFromDataTransfer = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const fileList: File[] = [];

    const traverseEntry = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        await new Promise<void>((resolve) => {
          fileEntry.file(
            (f) => {
              fileList.push(f);
              resolve();
            },
            () => resolve()
          );
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const dirReader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve) => {
          dirReader.readEntries((results) => resolve(Array.from(results)), () => resolve([]));
        });
        for (const child of entries) {
          await traverseEntry(child);
        }
      }
    };

    if (dataTransfer.items && dataTransfer.items.length > 0) {
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          await traverseEntry(entry);
        } else {
          const f = item.getAsFile();
          if (f) fileList.push(f);
        }
      }
    } else if (dataTransfer.files && dataTransfer.files.length > 0) {
      fileList.push(...Array.from(dataTransfer.files));
    }

    return fileList;
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) {
        setSelectedFiles((prev) => [...prev, ...files]);
        setError('');
      }
    } catch (err) {
      console.warn('Erro ao ler arquivos arrastados:', err);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleIngest = async () => {
    if (selectedFiles.length === 0) {
      setError('Selecione ao menos um arquivo do Brandbook (PDF, HTML, SVG, ZIP ou Imagem).');
      return;
    }

    setLoading(true);
    setError('');
    setStepText('Enviando arquivos do Brandbook...');

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });

      setStepText('Processando e analisando com I.A....');

      const response = await api.post<IngestResultData>(
        `/brands/${slug}/brandbook/ingest`,
        formData
      );

      setResult(response);
      if (onSuccess) onSuccess(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar o Brandbook.';
      setError(message);
    } finally {
      setLoading(false);
      setStepText('');
    }
  };

  const handleIngestCanva = async () => {
    if (!canvaUrl.trim()) {
      setError('Cole a URL ou o ID do design do Brandbook no Canva.');
      return;
    }

    setLoading(true);
    setError('');
    setStepText('Exportando páginas do Canva...');

    try {
      setStepText('Baixando páginas do Canva...');
      const response = await api.post<IngestResultData>(
        `/brands/${slug}/brandbook/ingest-canva`,
        { designUrl: canvaUrl.trim() }
      );

      setResult(response);
      if (onSuccess) onSuccess(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao importar Brandbook do Canva.';
      setError(message);
    } finally {
      setLoading(false);
      setStepText('');
    }
  };

  const handleConfirmLogo = async (newLogoUrl: string) => {
    setUpdatingLogo(true);
    try {
      await api.post(`/brands/${slug}/brandbook/confirm-logo`, { logoUrl: newLogoUrl });
      setLogoUpdated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar logo oficial.');
    } finally {
      setUpdatingLogo(false);
    }
  };

  const resetState = () => {
    setSelectedFiles([]);
    setCanvaUrl('');
    setResult(null);
    setError('');
    setLogoUpdated(false);
  };

  return (
    <div className={styles.overlay} onClick={() => !loading && onClose()}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <Sparkles size={20} className={styles.iconSparkle} />
            <h2>Adicionar Brandbook Completo</h2>
          </div>
          <button className={styles.closeButton} onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>

        {!result ? (
          <div className={styles.body}>
            <div className={styles.modeTabs}>
              <button
                type="button"
                className={`${styles.modeTab} ${ingestMode === 'files' ? styles.modeTabActive : ''}`}
                onClick={() => setIngestMode('files')}
              >
                <Upload size={14} />
                Arquivos (PDF / ZIP / SVG)
              </button>
              <button
                type="button"
                className={`${styles.modeTab} ${ingestMode === 'canva' ? styles.modeTabActive : ''}`}
                onClick={() => setIngestMode('canva')}
              >
                <FileImage size={14} />
                Importar do Canva
              </button>
            </div>

            <p className={styles.description}>
              Suba o manual em <strong>PDF, HTML, PNG/JPG, SVG</strong> ou um arquivo <strong>ZIP contendo pastas de SVGs</strong> (ou informe a URL de um design no Canva).
              A I.A. irá ler o documento, extrair diretrizes, paleta de cores, detectar logotipos, remontar vetores ausentes e classificar grafismos e ilustrações.
            </p>

            <details className={styles.promptGuide}>
              <summary>💡 Ver Guia de Prompts de IA para Benchmarking & Criação de Assets</summary>
              <div className={styles.promptGuideContent}>
                <p><strong>Prompt Base para Midjourney / DALL-E 3 / Recraft v3:</strong></p>
                <code>
                  Vector brand identity kit for "[Nome da Marca]", minimalist visual identity, flat vector shapes, brand mark logo, graphic patterns, decorative borders and icons, isolated on clean white background, brand color palette [Sua Paleta Hex] --no realistic, 3d, photo
                </code>
                <p><small>Dica: No Recraft.ai ou Illustrator, converta a imagem gerada para SVG vetorial antes do upload, ou deixe a I.A. do Designer pescar e vetorizar automaticamente ao subir a imagem/PDF.</small></p>
              </div>
            </details>

            {ingestMode === 'canva' ? (
              <div className={styles.canvaBox}>
                <label className={styles.canvaLabel}>URL ou ID do Design do Canva:</label>
                <Input
                  placeholder="https://www.canva.com/design/DAG.../edit"
                  value={canvaUrl}
                  onChange={(e) => setCanvaUrl(e.target.value)}
                  disabled={loading}
                />
                <p className={styles.canvaHint}>
                  Exporte ou selecione um template/Brandbook criado no Canva. O Designer irá baixar todas as páginas, separar os componentes e extrair os assets.
                </p>
              </div>
            ) : (
              <div
                className={`${styles.dropzone} ${isDraggingOver ? styles.dropzoneDragging : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.html,.htm,.css,.svg,.png,.jpg,.jpeg,.webp,.zip,application/zip,application/x-zip-compressed,application/octet-stream"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <Upload size={32} className={styles.uploadIcon} />
                <p className={styles.dropText}>
                  Arraste os arquivos aqui ou <span>clique para selecionar</span>
                </p>
                <p className={styles.dropHint}>PDF, HTML, SVG, ZIP de pastas vetoriais ou PNG (até 25MB)</p>
              </div>
            )}

            {ingestMode === 'files' && selectedFiles.length > 0 && (
              <div className={styles.fileList}>
                <h4>Arquivos selecionados ({selectedFiles.length}):</h4>
                <ul>
                  {selectedFiles.map((file, idx) => (
                    <li key={idx}>
                      {file.name.endsWith('.svg') ? (
                        <ImageIcon size={14} />
                      ) : (
                        <FileText size={14} />
                      )}
                      <span>{file.name}</span>
                      <small>({(file.size / 1024).toFixed(1)} KB)</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <div className={styles.errorBox}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className={styles.footer}>
              <Button variant="secondary" onClick={onClose} disabled={loading}>
                Cancelar
              </Button>
              {ingestMode === 'canva' ? (
                <Button onClick={handleIngestCanva} loading={loading} disabled={!canvaUrl.trim()}>
                  {loading ? stepText || 'Importando do Canva...' : 'Importar e Indexar do Canva'}
                </Button>
              ) : (
                <Button onClick={handleIngest} loading={loading} disabled={selectedFiles.length === 0}>
                  {loading ? stepText || 'Analisando Brandbook...' : 'Processar e Indexar Brandbook'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.resultBody}>
            <div className={styles.successBanner}>
              <CheckCircle size={24} color="#10B981" />
              <div>
                <h3>Brandbook Indexado com Sucesso!</h3>
                <p>Diretrizes, cores e SVGs foram catalogados na memória da marca.</p>
              </div>
            </div>

            {/* Resumo da Ingestão */}
            <div className={styles.summaryGrid}>
              <Card padding="sm" className={styles.summaryCard}>
                <div className={styles.summaryCardTitle}>
                  <Palette size={16} /> Paleta de Cores ({result.colors.length})
                </div>
                <div className={styles.paletteRow}>
                  {result.colors.map((color, i) => (
                    <div
                      key={i}
                      className={styles.colorChip}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </Card>

              <Card padding="sm" className={styles.summaryCard}>
                <div className={styles.summaryCardTitle}>
                  <Layers size={16} /> SVGs Classificados ({result.svgsIndexed.total})
                </div>
                <ul className={styles.svgCountList}>
                  <li>Logotipos: <strong>{result.svgsIndexed.logotypes}</strong></li>
                  <li>Grafismos de Marca: <strong>{result.svgsIndexed.graphicElements}</strong></li>
                  <li>Ilustrações & Ícones: <strong>{result.svgsIndexed.illustrations}</strong></li>
                </ul>
              </Card>
            </div>

            {/* Confirmação de Troca de Logo */}
            {result.logoNeedsConfirmation && result.detectedLogoUrl && (
              <div className={styles.logoPromptBox}>
                <h4>
                  <Sparkles size={16} /> Novo Logotipo Detectado
                </h4>
                <p>Identificamos um logotipo no Brandbook enviado. Deseja definir como logo oficial da marca?</p>

                <div className={styles.logoComparison}>
                  {result.currentLogoUrl && (
                    <div className={styles.logoCardItem}>
                      <span>Atual</span>
                      <img src={result.currentLogoUrl} alt="Logo Atual" />
                    </div>
                  )}
                  <div className={styles.logoCardItem}>
                    <span>Detectada</span>
                    <img src={result.detectedLogoUrl} alt="Nova Logo" />
                  </div>
                </div>

                {!logoUpdated ? (
                  <div className={styles.logoActions}>
                    <Button
                      size="sm"
                      onClick={() => handleConfirmLogo(result.detectedLogoUrl!)}
                      loading={updatingLogo}
                    >
                      Substituir pela Nova Logo
                    </Button>
                  </div>
                ) : (
                  <p className={styles.logoSuccessMsg}>
                    <CheckCircle size={14} /> Logo oficial atualizada com sucesso!
                  </p>
                )}
              </div>
            )}

            {/* Diretrizes em Texto */}
            <div className={styles.guidelinesPreview}>
              <h4>Diretrizes Extraídas pela I.A.</h4>
              <div className={styles.guidelinesText}>{result.guidelines}</div>
            </div>

            <div className={styles.footer}>
              <Button variant="secondary" onClick={resetState}>
                <RefreshCw size={14} /> Adicionar Outro Arquivo
              </Button>
              <Button onClick={onClose}>Concluir</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
