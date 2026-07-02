'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, AlertCircle, ExternalLink, Info } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from './canva.module.css';

const PENPOT_URL = process.env.NEXT_PUBLIC_PENPOT_URL?.replace(/\/$/, '') ?? '';

export default function PenpotConfigPage() {
  const params = useParams();
  const slug = params.marca as string;

  const isConfigured = !!PENPOT_URL;

  return (
    <div>
      <Link href={`/${slug}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Editor Penpot"
        description="Penpot é um editor de design open source self-hosted — equivalente ao Figma/Canva, sem sair do app."
      />

      <div className={styles.content}>
        {/* Status */}
        <Card padding="lg">
          <div className={styles.statusHeader}>
            <div className={isConfigured ? styles.statusIcon : styles.statusIconDisconnected}>
              {isConfigured ? <CheckCircle size={28} /> : <AlertCircle size={28} />}
            </div>
            <div>
              <h3 className={styles.statusTitle}>
                {isConfigured ? 'Penpot configurado' : 'Penpot não configurado'}
              </h3>
              <p className={styles.statusDesc}>
                {isConfigured
                  ? `Instância ativa em ${PENPOT_URL}`
                  : 'Adicione NEXT_PUBLIC_PENPOT_URL no .env.local para ativar o editor.'}
              </p>
            </div>
          </div>

          {isConfigured && (
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>URL da instância</span>
                <code className={styles.infoValue}>{PENPOT_URL}</code>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Status</span>
                <span className={styles.infoValue} style={{ color: '#22c55e' }}>Ativo</span>
              </div>
            </div>
          )}

          {isConfigured && (
            <div className={styles.actions}>
              <a href={PENPOT_URL} target="_blank" rel="noopener noreferrer">
                <button className={styles.btnSecondary}>
                  <ExternalLink size={16} />
                  Abrir Penpot
                </button>
              </a>
              <Link href={`/${slug}/editor`}>
                <button className={styles.btnPrimary}>
                  Abrir no editor do app
                </button>
              </Link>
            </div>
          )}
        </Card>

        {/* Setup guide */}
        {!isConfigured && (
          <Card padding="lg">
            <div className={styles.guideHeader}>
              <Info size={18} />
              <h4>Como configurar</h4>
            </div>
            <ol className={styles.steps}>
              <li>
                <strong>Instale o Penpot na VPS</strong> via Docker Compose:
                <pre className={styles.code}>{`docker compose -f docker-compose.yaml up -d`}</pre>
                <a
                  href="https://help.penpot.app/technical-guide/getting-started/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  Guia oficial de instalação <ExternalLink size={12} />
                </a>
              </li>
              <li>
                <strong>Configure um subdomínio</strong>, ex: <code>penpot.seudominio.com</code>
              </li>
              <li>
                <strong>Adicione ao <code>.env.local</code></strong> do frontend:
                <pre className={styles.code}>{`NEXT_PUBLIC_PENPOT_URL=https://penpot.seudominio.com`}</pre>
              </li>
              <li>
                <strong>Reinicie o servidor</strong> de desenvolvimento e volte aqui para confirmar.
              </li>
            </ol>
          </Card>
        )}

        {/* RAM warning */}
        <Card padding="md">
          <div className={styles.warningRow}>
            <AlertCircle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <p className={styles.warningText}>
              O Penpot exige <strong>~1.5–2 GB de RAM livre</strong> na VPS (JVM + PostgreSQL + Redis + Exporter).
              A VPS atual tem ~780 MB livres — um upgrade de RAM é necessário antes de instalar.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
