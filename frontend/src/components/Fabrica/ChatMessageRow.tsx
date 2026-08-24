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
import { Check, ChevronDown, ChevronRight, Loader2, Sparkles, X as XIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { FabricaAttachment, FabricaMessage } from '@/hooks/useFabricaWs';
import s from '@/app/[marca]/fabrica/fabrica.module.css';

function attachmentPreviewLabel(attachment: FabricaAttachment): string {
  if (attachment.mimeType.startsWith('image/')) return `${attachment.name} · imagem`;
  return attachment.name;
}

// `aoVivo` = ainda pensando e sem resposta escrita. Nesse estado o bloco abre
// sozinho: o raciocínio É o conteúdo da espera, e escondê-lo atrás de um clique
// devolve os três pontinhos que ele veio substituir. Quando a resposta começa,
// volta a recolher — a menos que a pessoa tenha clicado, e aí a escolha dela manda.
function ThinkingBlock({ thinking, aoVivo }: { thinking: string; aoVivo: boolean }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? aoVivo;
  const bodyId = useId();
  return (
    <div className={s.thinkingBlock}>
      <button
        type="button"
        className={s.thinkingHeader}
        onClick={() => setManual(!expanded)}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <Sparkles size={11} />
        <span>{aoVivo ? 'Pensando…' : expanded ? 'Ocultar raciocínio' : 'Mostrar raciocínio'}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && <div id={bodyId} className={s.thinkingBody}>{thinking}</div>}
    </div>
  );
}

// Nome técnico da skill não diz nada a quem usa. O rótulo é o que a ferramenta
// FAZ, na língua da pessoa.
const ROTULO_FERRAMENTA: Record<string, string> = {
  updateBrandMemory: 'Anotando preferência da marca',
  createAsanaTask: 'Criando tarefa no Asana',
  listAsanaProjects: 'Consultando projetos do Asana',
  generateRoteiroLink: 'Gerando link do roteiro',
};

function FerramentasUsadas({ tools }: { tools: NonNullable<FabricaMessage['tools']> }) {
  return (
    <div className={s.thinkingBlock}>
      {tools.map((t, i) => (
        <div key={`${t.name}-${i}`} className={s.thinkingHeader} style={{ cursor: 'default' }}>
          {t.ok === undefined
            ? <Loader2 size={11} className={s.spin} />
            : t.ok
              ? <Check size={11} />
              : <XIcon size={11} />}
          <span>{ROTULO_FERRAMENTA[t.name] ?? t.name}</span>
          {t.ok === false && t.detail && (
            <span style={{ opacity: 0.7 }}>— {t.detail.slice(0, 60)}</span>
          )}
        </div>
      ))}
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
  onOpenRoteiro?: (url: string) => void;
}

function ChatMessageRowImpl({ message, isStreamingMsg, onApproveImage, onRegenerateImage, onOpenRoteiro }: ChatMessageRowProps) {
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
        {message.thinking && (
          <ThinkingBlock thinking={message.thinking} aoVivo={isStreamingMsg && !message.content} />
        )}
        {message.tools && message.tools.length > 0 && <FerramentasUsadas tools={message.tools} />}
        {/* Sem isto a espera fica muda: os pontinhos da página só aparecem quando a
            última mensagem é do usuário, e agora o `thinking` já criou a do
            assistente antes do primeiro token. */}
        {isStreamingMsg && !message.content && !message.thinking && !message.tools?.length && (
          <div className={s.typingDots}><span /><span /><span /></div>
        )}
        {message.content && (
          <div className={`${s.aiText} ${isStreamingMsg ? s.aiTextStreaming : ''}`}>
            <ReactMarkdown
              components={{
                a: ({ node, ...props }) => {
                  if (props.href && props.href.includes('/roteiros/')) {
                    return (
                      <button 
                        type="button" 
                        onClick={(e) => { e.preventDefault(); onOpenRoteiro?.(props.href!); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px', 
                          background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)',
                          padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                          cursor: 'pointer', color: 'var(--color-text-primary)', marginTop: '8px'
                        }}
                      >
                        📝 Ver Roteiro Detalhado
                      </button>
                    );
                  }
                  return <a {...props} target="_blank" rel="noopener noreferrer" />;
                }
              }}
            >
              {message.content}
            </ReactMarkdown>
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
