'use client';

import { useState } from 'react';
import type { BrainMessage as BrainMessageType } from '@/hooks/useBrainSession';
import s from './fabrica-chat.module.css';

interface Props {
  message: BrainMessageType;
  isStreaming?: boolean;
  onFormSubmit?: (formId: string, response: string) => void;
}

export function BrainMessage({ message, isStreaming, onFormSubmit }: Props) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  function handleFormSelect(optionId: string) {
    if (selectedOption) return;
    setSelectedOption(optionId);
    if (message.form && onFormSubmit) {
      const label = message.form.options?.find(o => o.id === optionId)?.label ?? optionId;
      onFormSubmit(message.form.id, label);
    }
  }

  return (
    <div className={s.brainRow}>
      <div className={s.brainAvatar}>
        <svg className={s.brainAvatarIcon} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      </div>

      <div className={s.brainContent}>
        {/* Thinking block */}
        {message.thinking && (
          <div className={s.thinking}>
            <div
              className={s.thinkingHeader}
              onClick={() => setThinkingOpen(o => !o)}
            >
              <svg className={`${s.thinkingChevron} ${thinkingOpen ? s.open : ''}`} viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" />
              </svg>
              <span>Raciocínio</span>
            </div>
            {thinkingOpen && (
              <div className={s.thinkingBody}>{message.thinking}</div>
            )}
          </div>
        )}

        {/* Texto */}
        {message.content && (
          <p className={s.brainText}>
            {message.content}
            {isStreaming && !message.form && (
              <span className={s.streamingDot} />
            )}
          </p>
        )}

        {/* Inline form */}
        {message.form && (
          <div className={s.form}>
            <div className={s.formQuestion}>{message.form.question}</div>
            {message.form.options && (
              <div className={s.formOptions}>
                {message.form.options.map(opt => (
                  <button
                    key={opt.id}
                    className={`${s.formOption} ${selectedOption === opt.id ? s.selected : ''}`}
                    onClick={() => handleFormSelect(opt.id)}
                    disabled={!!selectedOption}
                  >
                    <span className={s.formOptionCheck}>
                      {selectedOption === opt.id && (
                        <svg width={8} height={8} viewBox="0 0 8 8" fill="white">
                          <path d="M1 4l2 2 4-4" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      )}
                    </span>
                    <span>
                      <div className={s.formOptionLabel}>{opt.label}</div>
                      {opt.description && (
                        <div className={s.formOptionDesc}>{opt.description}</div>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
