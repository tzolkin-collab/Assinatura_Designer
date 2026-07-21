'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, Upload, Image as ImageIcon, FileType2, Trash2, Loader2, X, HardDrive, CheckSquare } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import styles from '../configuracoes.module.css';
import { api, getApiErrorMessage } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';

const DrivePopup = dynamic(() => import('@/components/Fabrica/DrivePopup').then((m) => ({ default: m.DrivePopup })), { ssr: false });
const AsanaPopup = dynamic(() => import('@/components/Fabrica/AsanaPopup').then((m) => ({ default: m.AsanaPopup })), { ssr: false });

interface Asset {
  id: string;
  name: string;
  url: string;
  fileType: string;
  sizeBytes: number;
}

export default function MidiaPage() {
  const params = useParams();
  const slug = params.marca as string;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [popupAberto, setPopupAberto] = useState<'drive' | 'asana' | null>(null);

  const { can, hint } = useBrandPermissions();
  const canManageAssets = can('manage-assets');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportAttachments = async (
    _text: string,
    attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>,
  ) => {
    setPopupAberto(null);
    if (!attachments || attachments.length === 0) return;

    setImportando(true);
    setErro('');
    try {
      await api.post(`/brands/${slug}/assets/import-base64`, { attachments });
      fetchAssets();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Não consegui importar os arquivos selecionados.'));
    } finally {
      setImportando(false);
    }
  };

  const fetchAssets = async () => {
    try {
      const res = await api.get<Asset[]>(`/brands/${slug}/assets`);
      setAssets(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [slug]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setErro('');
    try {
      await api.uploadFile(`/brands/${slug}/assets`, file);
      fetchAssets();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Falha ao enviar arquivo.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = async (assetId: string) => {
    if (!confirm('Excluir este arquivo permanentemente? Ele não carregará mais nos designs onde foi usado.')) return;
    setErro('');
    try {
      await api.delete(`/brands/${slug}/assets/${assetId}`);
      fetchAssets();
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não foi possível excluir o arquivo.'));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <PageHeader
          title="Biblioteca de Mídia"
          description="Imagens, vetores e fontes disponíveis para todos os usuários desta marca."
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
            accept="image/*,font/*,.svg"
          />
          <Button
            variant="secondary"
            onClick={() => setPopupAberto('drive')}
            disabled={uploading || importando || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            <HardDrive size={16} />
            Importar do Drive
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPopupAberto('asana')}
            disabled={uploading || importando || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            <CheckSquare size={16} />
            Importar do Asana
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || importando || !canManageAssets}
            title={canManageAssets ? undefined : hint}
          >
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {uploading ? 'Enviando...' : 'Fazer Upload'}
          </Button>
        </div>
      </div>

      {importando && (
        <p style={{ fontSize: '13px', color: 'var(--color-text-dim)', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Loader2 className="animate-spin" size={14} /> Importando arquivos selecionados...
        </p>
      )}

      {popupAberto === 'drive' && (
        <DrivePopup onClose={() => setPopupAberto(null)} onInject={handleImportAttachments} />
      )}
      {popupAberto === 'asana' && (
        <AsanaPopup onClose={() => setPopupAberto(null)} onInject={handleImportAttachments} />
      )}

      {erro && (
        <p style={{ fontSize: '13px', color: '#ef4444', marginTop: '12px' }} role="alert">
          {erro}
        </p>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '16px',
        marginTop: '24px'
      }}>
        {loading ? (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Loader2 className="animate-spin" size={16} /> Carregando mídias...
          </div>
        ) : assets.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: 'var(--color-text-dim)', border: '1px dashed var(--color-border)', borderRadius: '12px' }}>
            <ImageIcon size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <p>Nenhuma mídia encontrada na biblioteca da marca.</p>
          </div>
        ) : (
          assets.map(asset => (
            <Card key={asset.id} padding="none" style={{ overflow: 'hidden', position: 'relative' }}>
              <div style={{ height: '140px', background: 'var(--color-bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {asset.fileType.startsWith('image/') ? (
                  <img src={asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <FileType2 size={32} style={{ color: 'var(--color-text-dim)' }} />
                )}
              </div>
              <div style={{ padding: '12px' }}>
                <div style={{ fontWeight: 500, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {asset.name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{formatSize(asset.sizeBytes)}</span>
                  <span>{asset.fileType.split('/')[1]?.toUpperCase()}</span>
                </div>
              </div>
              
              <button
                onClick={() => handleRemove(asset.id)}
                disabled={!canManageAssets}
                title={canManageAssets ? 'Excluir arquivo' : hint}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.7)', border: 'none', color: '#ef4444',
                  width: 28, height: 28, borderRadius: '6px',
                  display: canManageAssets ? 'flex' : 'none',
                  alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                }}>
                <Trash2 size={14} />
              </button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
