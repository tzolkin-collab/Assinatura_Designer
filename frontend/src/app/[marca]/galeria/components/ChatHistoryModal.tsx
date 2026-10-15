import React from 'react';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import { FabricaChatHistoryMessage } from '@/lib/designContent';
import styles from '../brand-galeria.module.css';

interface ChatHistoryModalProps {
  chatHistoryPreview: {
    sessionId: string | null;
    messages: FabricaChatHistoryMessage[];
    postLabel: string;
  };
  onClose: () => void;
  slug: string;
}

function formatChatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatAttachmentLabel(name: string, mimeType: string) {
  if (mimeType.startsWith('image/')) return `${name} · imagem`;
  return name;
}

export function ChatHistoryModal({
  chatHistoryPreview,
  onClose,
  slug
}: ChatHistoryModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.chatHistoryModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h3 className={styles.modalTitle}>Histórico da conversa</h3>
            <p className={styles.chatHistorySubtitle}>{chatHistoryPreview.postLabel}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className={styles.chatHistoryMetaRow}>
          <span className={styles.chatSessionBadge}>Sessão: {chatHistoryPreview.sessionId ?? 'não registrada'}</span>
          {chatHistoryPreview.sessionId && (
            <Link href={`/${slug}/fabrica?sessionId=${encodeURIComponent(chatHistoryPreview.sessionId)}`} className={styles.chatSessionLink}>
              <ExternalLink size={14} />
              Abrir sessão
            </Link>
          )}
        </div>
        <div className={styles.chatHistoryBody}>
          {chatHistoryPreview.messages.length === 0 ? (
            <div className={styles.empty}>Nenhuma mensagem foi salva neste design.</div>
          ) : (
            chatHistoryPreview.messages.map((message, index) => (
              <div key={`${message.timestamp}-${index}`} className={`${styles.chatBubble} ${styles[`chatBubble${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}` as keyof typeof styles]}`}>
                <div className={styles.chatBubbleMeta}>
                  <span className={styles.chatBubbleRole}>{message.role}</span>
                  <span className={styles.chatBubbleTime}>{formatChatTimestamp(message.timestamp)}</span>
                </div>
                <p className={styles.chatBubbleContent}>{message.content}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <div className={styles.chatAttachmentsList}>
                    {message.attachments.map((attachment, attachmentIndex) => (
                      <span key={`${attachment.name}-${attachmentIndex}`} className={styles.chatAttachmentPill}>
                        {formatAttachmentLabel(attachment.name, attachment.mimeType)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
