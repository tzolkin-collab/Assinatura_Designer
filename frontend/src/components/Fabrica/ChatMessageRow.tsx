'use client';

// UMA linha da conversa da Fábrica, memoizada.
//
// react-markdown NÃO se memoiza internamente (confirmado: sem React.memo no
// pacote) — sem isto, cada token do streaming (setMsgs em useFabricaWs cria
// um array `messages` NOVO) fazia o componente pai re-executar o `.map()`
// inteiro e reprocessar o Markdown de TODAS as mensagens da conversa a cada
// token, não só a que está sendo escrita. Numa conversa longa isso é
// O(mensagens) de trabalho jogado fora por token — a causa concreta da
// "renderização lenta" relatada.
//
// React.memo compara por REFERÊNCIA: como useFabricaWs só troca o objeto da
// mensagem que está mudando (`prev.map(m => m.id === last.id ? {...} : m)`),
// as demais mensagens mantêm a MESMA referência entre renders — este
// componente pula o re-render (e o re-parse do Markdown) para elas.

import { memo, useId, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { FabricaAttachment, FabricaMessage } from '@/hooks/useFabricaWs';
import s from '@/app/[marca]/fabrica/fabrica.module.css';

function attachmentPreviewLabel(attachment: FabricaAttachment): string {
  if (attachment.mimeType.startsWith('image/')) return `${attachment.name} · imagem`;
  return attachment.name;
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <div className={s.thinkingBlock}>
      <button
        type="button"
        className={s.thinkingHeader}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <Sparkles size={11} />
        <span>{expanded ? 'Ocultar raciocínio' : 'Mostrar raciocínio'}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && <div id={bodyId} className={s.thinkingBody}>{thinking}</div>}
    </div>
  );
}

interface ChatMessageRowProps {
  message: FabricaMessage;
  /** Só true para a ÚLTIMA mensagem do assistente enquanto ainda streama —
   *  liga o cursor piscante (aiTextStreaming). Fica false (estável) para
   *  todas as mensagens antigas, então nunca invalida o memo delas. */
  isStreamingMsg: boolean;
  onApproveImage?: (url: string) => void;
  onRegenerateImage?: (prompt: string) => void;
}

function ChatMessageRowImpl({ message, isStreamingMsg, onApproveImage, onRegenerateImage }: ChatMessageRowProps) {
  if (message.role === 'user') {
    const asanaSplit = message.content.split('\n\n[Contexto Asana]\n');
    const mainText = asanaSplit[0];
    const asanaBlock = asanaSplit[1];
    return (
      <div className={s.userRow}>
        <div className={s.userBubble}>
          <span>{mainText}</span>
          {message.attachments && message.attachments.length > 0 && (
            <div className={s.messageAttachments}>
              {message.attachments.map((attachment, attachmentIndex) => (
                <span key={`${attachment.name}-${attachmentIndex}`} className={s.messageAttachmentPill}>
                  {attachmentPreviewLabel(attachment)}
                </span>
              ))}
            </div>
          )}
          {asanaBlock && (
            <div className={s.asanaBlock}>
              <div className={s.asanaBlockHeader}>
                <img src="/asana-logo.svg" width={11} height={11} alt="" />
                <span>Contexto Asana</span>
              </div>
              <pre className={s.asanaBlockBody}>{asanaBlock}</pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className={s.systemRow}>
        <span>{message.content}</span>
      </div>
    );
  }

  return (
    <div className={s.aiRow}>
      <div className={s.aiAvatar}>
        <Sparkles size={11} />
      </div>
      <div className={s.aiBubble}>
        {message.thinking && <ThinkingBlock thinking={message.thinking} />}
        {message.content && (
          <div className={`${s.aiText} ${isStreamingMsg ? s.aiTextStreaming : ''}`}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.imageProposal && (
          <div className={s.imageProposalWidget}>
            {message.imageProposal.status === 'generating' && (
              <div className={s.imageProposalLoading}>
                <span className={s.imageProposalSpinner} />
                <span>Gerando imagem...</span>
              </div>
            )}
            {message.imageProposal.status === 'error' && (
              <div className={s.imageProposalError}>
                <span>Erro ao gerar imagem: {message.imageProposal.error}</span>
                <button type="button" onClick={() => onRegenerateImage?.(message.imageProposal!.prompt)}>Tentar Novamente</button>
              </div>
            )}
            {message.imageProposal.status === 'done' && message.imageProposal.url && (
              <div className={s.imageProposalDone}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={message.imageProposal.url} alt="Imagem gerada" className={s.imageProposalImg} />
                <div className={s.imageProposalActions}>
                  <button type="button" className={s.imageProposalApproveBtn} onClick={() => onApproveImage?.(message.imageProposal!.url!)}>Aprovar e Usar</button>
                  <button type="button" className={s.imageProposalRegenBtn} onClick={() => onRegenerateImage?.(message.imageProposal!.prompt)}>Pedir Outra</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessageRow = memo(ChatMessageRowImpl);
