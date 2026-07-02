'use client';

import { X, Wand2 } from 'lucide-react';
import type { DesignPage } from '@/components/Fabrica/DesignRenderer';
import type { DesignIssue, FixStatus, FixerPhase } from '@/hooks/useDesignFixer';
import styles from './AIFixPanel.module.css';

const PHASE_LABELS: Record<FixerPhase, string> = {
  idle:      'Aguardando',
  analyzing: 'Analisando design...',
  planning:  'Planejando correções...',
  review:    'Selecione as correções',
  executing: 'Executando correções...',
  verifying: 'Verificando resultado...',
  done:      'Concluído',
  error:     'Erro',
};

const FIX_ICONS: Record<FixStatus['status'], string> = {
  pending: '⏳',
  running: '🔄',
  success: '✅',
  failed:  '❌',
};

const STRATEGY_LABELS: Record<string, string> = {
  reposition:          'Reposicionar',
  resize:              'Redimensionar',
  recolor:             'Recolorir',
  rewrite:             'Reescrever',
  'adjust-opacity':    'Ajustar opacidade',
  'adjust-zindex':     'Ajustar ordem (z-index)',
  'regenerate-visual': 'Regenerar visual (NanoBanana)',
};

function IssueItem({ issue }: { issue: DesignIssue }) {
  return (
    <div className={styles.issueRow}>
      <span className={styles.severityDot} data-severity={issue.severity} />
      <div className={styles.issueText}>
        <p className={styles.issueDesc}>{issue.description}</p>
        {issue.suggestedFix && (
          <p className={styles.issueFix}>↳ {issue.suggestedFix}</p>
        )}
      </div>
      <span className={styles.issueBadge} data-severity={issue.severity}>
        {issue.severity}
      </span>
    </div>
  );
}

function FixItem({
  fs,
  selectable,
  selected,
  onToggle,
}: {
  fs: FixStatus;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const { fix, status, explanation, confidence, newIssues } = fs;
  return (
    <div
      className={`${styles.fixRow} ${selectable ? styles.fixRowSelectable : ''} ${selectable && selected ? styles.fixRowSelected : ''}`}
      data-status={status}
      onClick={selectable ? onToggle : undefined}
      role={selectable ? 'checkbox' : undefined}
      aria-checked={selectable ? selected : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={selectable ? (e) => e.key === ' ' && onToggle?.() : undefined}
    >
      {selectable && (
        <span className={`${styles.fixCheckbox} ${selected ? styles.fixCheckboxChecked : ''}`} />
      )}
      {!selectable && (
        <span className={styles.fixIcon}>{FIX_ICONS[status]}</span>
      )}
      <div className={styles.fixContent}>
        {fix.isReactive && <p className={styles.fixReactive}>Reativo</p>}
        <p className={styles.fixDesc}>{fix.description}</p>
        <p className={styles.fixStrategy}>
          {STRATEGY_LABELS[fix.strategy] ?? fix.strategy}
          {' · '}Slide {fix.slideIndex + 1}
        </p>
        {explanation && (
          <p className={styles.fixExplanation}>{explanation}</p>
        )}
        {typeof confidence === 'number' && status !== 'pending' && (
          <p className={styles.fixConfidence}>
            Confiança: <span>{Math.round(confidence * 100)}%</span>
          </p>
        )}
        {newIssues && newIssues.length > 0 && (
          <p className={styles.fixExplanation}>
            ⚠ {newIssues.length} novo{newIssues.length > 1 ? 's' : ''} problema{newIssues.length > 1 ? 's' : ''} detectado{newIssues.length > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

interface AIFixPanelProps {
  phase: FixerPhase;
  issues: DesignIssue[];
  fixList: FixStatus[];
  selectedFixIds: Set<string>;
  remainingIssues: DesignIssue[];
  correctedPages: DesignPage[] | null;
  iteration: number;
  errorMessage: string | null;
  /** Called when user confirms applying the corrected pages (done phase) */
  onApply: (pages: DesignPage[]) => void;
  /** Called when user clicks "Aplicar Selecionados" (review phase) */
  onApplySelected: () => void;
  /** Called when user clicks "Corrigir Tudo (Auto)" from review phase */
  onAutoFix: () => void;
  toggleFix: (fixId: string) => void;
  selectAll: () => void;
  selectNone: () => void;
  onClose: () => void;
}

export default function AIFixPanel({
  phase,
  issues,
  fixList,
  selectedFixIds,
  remainingIssues,
  correctedPages,
  iteration,
  errorMessage,
  onApply,
  onApplySelected,
  onAutoFix,
  toggleFix,
  selectAll,
  selectNone,
  onClose,
}: AIFixPanelProps) {
  const isRunning = phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'review';
  const selectedCount = selectedFixIds.size;

  return (
    <>
      <div className={styles.backdrop} onClick={isRunning ? undefined : onClose} />
      <div className={styles.panel}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <h2 className={styles.title}>
              <Wand2 size={15} className={styles.titleIcon} />
              Correção com IA
            </h2>
            <button className={styles.closeBtn} onClick={onClose} title="Fechar">
              <X size={16} />
            </button>
          </div>
          <div className={styles.phaseBar}>
            {isRunning && <span className={styles.spinner} />}
            <span className={styles.phaseLabel}>
              {PHASE_LABELS[phase]}
              {iteration > 1 && ` (iteração ${iteration})`}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>

          {/* Error */}
          {phase === 'error' && (
            <div className={styles.errorBox}>
              <p className={styles.errorTitle}>Falha na correção</p>
              <p className={styles.errorMsg}>{errorMessage ?? 'Erro desconhecido. Tente novamente.'}</p>
            </div>
          )}

          {/* Done summary */}
          {phase === 'done' && (
            <div className={styles.doneBox}>
              <p className={styles.doneTitle}>
                {remainingIssues.length === 0 ? '✅ Design corrigido!' : '⚠ Correção parcial'}
              </p>
              <p className={styles.doneMsg}>
                {remainingIssues.length === 0
                  ? `${fixList.filter(f => f.status === 'success').length} correções aplicadas com sucesso.`
                  : `${remainingIssues.length} problema${remainingIssues.length > 1 ? 's' : ''} persistente${remainingIssues.length > 1 ? 's' : ''} — revise manualmente se necessário.`}
              </p>
            </div>
          )}

          {/* Issues found */}
          {issues.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>
                {issues.length} problema{issues.length !== 1 ? 's' : ''} encontrado{issues.length !== 1 ? 's' : ''}
              </p>
              {issues.map(issue => (
                <IssueItem key={issue.id} issue={issue} />
              ))}
            </div>
          )}

          {/* Review: selection controls + selectable fix list */}
          {phase === 'review' && fixList.length > 0 && (
            <div className={styles.section}>
              <div className={styles.reviewActions}>
                <p className={styles.sectionTitle}>
                  Plano de correção
                  {' · '}
                  {selectedCount}/{fixList.length} selecionadas
                </p>
                <div className={styles.selectLinks}>
                  <button className={styles.selectLink} onClick={selectAll}>Todos</button>
                  <span className={styles.selectLinkDivider}>·</span>
                  <button className={styles.selectLink} onClick={selectNone}>Nenhum</button>
                </div>
              </div>
              {fixList.map(fs => (
                <FixItem
                  key={fs.fix.id}
                  fs={fs}
                  selectable
                  selected={selectedFixIds.has(fs.fix.id)}
                  onToggle={() => toggleFix(fs.fix.id)}
                />
              ))}
            </div>
          )}

          {/* Fix queue (executing/verifying/done) */}
          {phase !== 'review' && fixList.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>
                Plano de correção
                {' · '}
                {fixList.filter(f => f.status === 'success').length}/{fixList.length} concluídas
              </p>
              {fixList.map(fs => (
                <FixItem key={fs.fix.id} fs={fs} />
              ))}
            </div>
          )}

          {/* Remaining issues after verify */}
          {remainingIssues.length > 0 && phase === 'done' && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Problemas persistentes</p>
              {remainingIssues.map(issue => (
                <IssueItem key={issue.id} issue={issue} />
              ))}
            </div>
          )}

          {/* Idle/analyzing with no content yet */}
          {(phase === 'analyzing' || phase === 'planning') && issues.length === 0 && (
            <p className={styles.empty}>Analisando todos os slides...</p>
          )}

        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {phase === 'review' && (
            <>
              <button
                className={styles.applyBtn}
                disabled={selectedCount === 0}
                onClick={onApplySelected}
              >
                Aplicar{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
              <button className={styles.autoFixBtn} onClick={onAutoFix} title="Corrigir tudo automaticamente">
                Auto
              </button>
              <button className={styles.discardBtn} onClick={onClose}>
                Cancelar
              </button>
            </>
          )}
          {phase === 'done' && (
            <>
              <button
                className={styles.applyBtn}
                disabled={!correctedPages}
                onClick={() => correctedPages && onApply(correctedPages)}
              >
                Aplicar Correção
              </button>
              <button className={styles.discardBtn} onClick={onClose}>
                Descartar
              </button>
            </>
          )}
          {phase !== 'review' && phase !== 'done' && (
            <button className={styles.discardBtn} style={{ flex: 1 }} onClick={onClose}>
              {phase === 'error' ? 'Fechar' : 'Cancelar'}
            </button>
          )}
        </div>

      </div>
    </>
  );
}
