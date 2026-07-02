'use client';

import { useState } from 'react';
import type { StructureTree } from '@/hooks/useBrainSession';
import s from './fabrica-chat.module.css';

const PHASE_LABELS: Record<string, string> = {
  listening: 'Escutando',
  clarifying: 'Refinando',
  ready: 'Preparando',
  running: 'Gerando',
  reviewing: 'Revisando',
  revising: 'Corrigindo',
  done: 'Concluído',
  error: 'Erro',
};

interface Props {
  structure: StructureTree;
  workerProgress: number;
}

export function StructurePanel({ structure, workerProgress }: Props) {
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set(['session', 'brief']));

  function toggle(key: string) {
    setOpenNodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      
      next.add(key);
      return next;
    });
  }

  const isOpen = (key: string) => openNodes.has(key);

  return (
    <div className={s.structure}>
      {/* Sessão */}
      <TreeNode
        id="session"
        icon={<FolderIcon />}
        label="Sessão atual"
        open={isOpen('session')}
        onToggle={() => toggle('session')}
      >
        <Leaf keyName="fase" value={PHASE_LABELS[structure.phase] ?? structure.phase} />
      </TreeNode>

      {/* Brief */}
      {structure.brief && (
        <TreeNode
          id="brief"
          icon={<DocumentIcon />}
          label="Brief criativo"
          open={isOpen('brief')}
          onToggle={() => toggle('brief')}
        >
          <Leaf keyName="objetivo" value={structure.brief.objective} />
          <Leaf keyName="formato" value={`${structure.brief.format} · ${structure.brief.slideCount} slides`} />
          <Leaf keyName="tom" value={structure.brief.toneAndVoice} />
          <Leaf keyName="narrativa" value={structure.brief.narrativeStructure} />
          <Leaf keyName="visual" value={structure.brief.visualDirection} />
          {structure.brief.outlineCount > 0 && (
            <Leaf keyName="roteiro" value={`${structure.brief.outlineCount} slides mapeados`} />
          )}
          {structure.brief.qualityCriteria.length > 0 && (
            <Leaf keyName="qualidade" value={`${structure.brief.qualityCriteria.length} critérios`} />
          )}
        </TreeNode>
      )}

      {/* Memória */}
      {structure.memory && (
        <TreeNode
          id="memory"
          icon={<BrainIcon />}
          label="Memória"
          open={isOpen('memory')}
          onToggle={() => toggle('memory')}
        >
          {structure.memory.currentStatus && (
            <Leaf keyName="status" value={structure.memory.currentStatus} />
          )}
          {structure.memory.recentDecisions.slice(-2).map((d, i) => (
            <Leaf key={i} keyName={`decisão ${i + 1}`} value={d.replace(/^\[.*?\]\s*/, '')} />
          ))}
          {Object.entries(structure.memory.formResponses).map(([k, v]) => (
            <Leaf key={k} keyName={k} value={v} />
          ))}
        </TreeNode>
      )}

      {/* Worker */}
      {structure.worker && (
        <TreeNode
          id="worker"
          icon={<CogIcon />}
          label="Worker Designer"
          badge={
            structure.worker.status === 'running'
              ? <span className={`${s.structureBadge} ${s.running}`}>gerando</span>
              : structure.worker.status === 'done'
              ? <span className={`${s.structureBadge} ${s.done}`}>pronto</span>
              : structure.worker.status === 'error'
              ? <span className={`${s.structureBadge} ${s.error}`}>erro</span>
              : null
          }
          open={isOpen('worker')}
          onToggle={() => toggle('worker')}
        >
          {structure.worker.status === 'running' && (
            <div className={s.workerProgress}>
              <div className={s.workerProgressBar}>
                <div
                  className={s.workerProgressFill}
                  style={{ width: `${workerProgress}%` }}
                />
              </div>
            </div>
          )}
          <Leaf keyName="status" value={structure.worker.status} />
          {structure.worker.postId && (
            <Leaf keyName="post id" value={structure.worker.postId.slice(0, 8) + '…'} />
          )}
        </TreeNode>
      )}

      {/* Auditoria */}
      {structure.audit && (
        <TreeNode
          id="audit"
          icon={<CheckIcon />}
          label="Auditoria"
          open={isOpen('audit')}
          onToggle={() => toggle('audit')}
        >
          <div className={s.auditCard}>
            <div className={s.auditHeader}>
              <span className={s.auditScore}>Score: {structure.audit.score}/100</span>
              {structure.audit.approved
                ? <span className={s.auditApproved}>Aprovado</span>
                : <span className={s.auditRejected}>Correções</span>
              }
            </div>
            {structure.audit.deviations.length > 0 && (
              <div className={s.auditDeviations}>
                {structure.audit.deviations.map((d, i) => (
                  <div key={i} className={`${s.auditDeviation} ${s[d.severity]}`}>
                    {d.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TreeNode>
      )}
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function TreeNode({
  id,
  icon,
  label,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={s.structureNode}>
      <div className={s.structureRow} onClick={onToggle}>
        <span className={s.structureIcon}>{icon}</span>
        <span className={s.structureLabel}>{label}</span>
        {badge}
        <ChevronIcon open={open} />
      </div>
      {open && children && (
        <div className={s.structureChildren}>{children}</div>
      )}
    </div>
  );
}

function Leaf({ keyName, value }: { keyName: string; value: string }) {
  return (
    <div className={s.structureLeaf}>
      <span className={s.structureLeafKey}>{keyName}</span>
      <span className={s.structureLeafValue} title={value}>{value}</span>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6a.5.5 0 0 1 .354.146L7.56 3.354A.5.5 0 0 0 7.914 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <path d="M5 10.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
      <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13z" />
      <path d="M7.25 4a.75.75 0 0 1 1.5 0v4.5H11a.75.75 0 0 1 0 1.5H7.25V4z" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.474l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      width={10}
      height={10}
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', opacity: 0.4 }}
    >
      <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" />
    </svg>
  );
}
