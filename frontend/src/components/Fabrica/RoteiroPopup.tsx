'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import styles from './connectorPopup.module.css';

interface Props {
  url: string;
  onClose: () => void;
}

export function RoteiroPopup({ url, onClose }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then(res => res.text())
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        setContent('Erro ao carregar roteiro: ' + err.message);
        setLoading(false);
      });
  }, [url]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.popup} ${styles.popupWide}`} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <span className={styles.headerTitle}>Roteiro Proposto</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        
        <div className={styles.content} style={{ padding: '20px', overflowY: 'auto' }}>
          {loading ? (
            <div className={styles.center}>
              <Loader2 size={22} className={styles.spin} style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
          ) : (
            <div style={{ lineHeight: '1.6', fontSize: '14px', color: 'var(--color-text-primary)' }}>
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
