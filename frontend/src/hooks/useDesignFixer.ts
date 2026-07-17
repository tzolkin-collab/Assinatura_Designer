'use client';

import { useState, useCallback, useRef } from 'react';
import type { DesignPage } from '@/components/Fabrica/DesignRenderer';

export type DesignIssue = {
  id: string;
  type: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  affectedLayerIds: string[];
  slideIndex: number;
  suggestedFix: string;
};

export type DesignFix = {
  id: string;
  issueId: string;
  priority: number;
  strategy: string;
  description: string;
  slideIndex: number;
  affectedLayerIds: string[];
  rationale: string;
  isReactive?: boolean;
};

export type FixStatus = {
  fix: DesignFix;
  status: 'pending' | 'running' | 'success' | 'failed';
  explanation?: string;
  confidence?: number;
  newIssues?: DesignIssue[];
};

export type FixerPhase =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'review'      // interactive: plan received, waiting for user selection
  | 'executing'
  | 'verifying'
  | 'done'
  | 'error';

interface UseDesignFixerReturn {
  phase: FixerPhase;
  issues: DesignIssue[];
  fixList: FixStatus[];
  selectedFixIds: Set<string>;
  remainingIssues: DesignIssue[];
  /** Preenchido quando a verificação final não rodou: `remainingIssues` vazio aqui
   *  significa "não sabemos", não "sem problemas". */
  verifyWarning: string | null;
  correctedPages: DesignPage[] | null;
  iteration: number;
  errorMessage: string | null;
  /** Full auto-mode: analyze → plan → execute */
  startFix: (pages: DesignPage[], marca: string) => void;
  /** Interactive: analyze + plan only, then waits for applySelected */
  startPlanOnly: (pages: DesignPage[], marca: string) => void;
  /** Toggle a fix in/out of the selection */
  toggleFix: (fixId: string) => void;
  /** Select all or none */
  selectAll: () => void;
  selectNone: () => void;
  /** Execute only the selectedFixIds */
  applySelected: (pages: DesignPage[], marca: string) => void;
  abort: () => void;
  reset: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useDesignFixer(): UseDesignFixerReturn {
  const [phase, setPhase] = useState<FixerPhase>('idle');
  const [issues, setIssues] = useState<DesignIssue[]>([]);
  const [fixList, setFixList] = useState<FixStatus[]>([]);
  const [selectedFixIds, setSelectedFixIds] = useState<Set<string>>(new Set());
  const [remainingIssues, setRemainingIssues] = useState<DesignIssue[]>([]);
  const [verifyWarning, setVerifyWarning] = useState<string | null>(null);
  const [correctedPages, setCorrectedPages] = useState<DesignPage[] | null>(null);
  const [iteration, setIteration] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abort();
    setPhase('idle');
    setIssues([]);
    setFixList([]);
    setSelectedFixIds(new Set());
    setRemainingIssues([]);
    setCorrectedPages(null);
    setIteration(1);
    setErrorMessage(null);
  }, [abort]);

  /**
   * Consumes the SSE stream from /fix-design.
   * planOnly=true → 'complete' transitions to 'review' instead of 'done'
   * and does not overwrite correctedPages (original pages stay intact).
   */
  const consumeSse = useCallback(async (response: Response, planOnly: boolean) => {
    if (!response.body) throw new Error('No response body');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

        switch (event.type as string) {
          case 'analyze-start':
            setPhase('analyzing');
            break;

          case 'iteration-start':
            setIteration((event.iteration as number) ?? 1);
            break;

          case 'analyze-done':
            setIssues((event.issues as DesignIssue[]) ?? []);
            setPhase('planning');
            break;

          case 'plan-done': {
            const fixes = (event.fixes as DesignFix[]) ?? [];
            setFixList(fixes.map(f => ({ fix: f, status: 'pending' as const })));
            // In planOnly mode the backend closes the stream after this;
            // stay in 'planning' until the 'complete' event flips to 'review'.
            if (!planOnly) setPhase('executing');
            break;
          }

          case 'fix-start': {
            const fix = event.fix as DesignFix;
            setFixList(prev =>
              prev.map(fs => fs.fix.id === fix.id ? { ...fs, status: 'running' as const } : fs)
            );
            break;
          }

          case 'fix-done': {
            const fix = event.fix as DesignFix;
            const exec = event.execution as {
              success: boolean;
              explanation: string;
              confidence: number;
              newIssues: DesignIssue[];
            } | undefined;
            setFixList(prev =>
              prev.map(fs =>
                fs.fix.id === fix.id
                  ? {
                      ...fs,
                      status: exec?.success ? 'success' as const : 'failed' as const,
                      explanation: exec?.explanation,
                      confidence: exec?.confidence,
                      newIssues: exec?.newIssues,
                    }
                  : fs
              )
            );
            break;
          }

          case 'fix-added': {
            const fix = event.fix as DesignFix;
            setFixList(prev => [...prev, { fix, status: 'pending' as const }]);
            break;
          }

          case 'verify-start':
            setPhase('verifying');
            break;

          case 'verify-done':
            setRemainingIssues((event.remaining as DesignIssue[]) ?? []);
            setVerifyWarning((event.message as string) ?? null);
            break;

          case 'complete':
            if (planOnly) {
              setPhase('review');
              break;
            }
            
            setCorrectedPages(event.pages as DesignPage[]);
            setPhase('done');
            break;

          case 'error':
            setErrorMessage((event.message as string) ?? 'Erro desconhecido');
            setPhase('error');
            break;
        }
      }
    }
  }, []);

  const startFixJob = useCallback(async (marca: string, payload: Record<string, unknown>, planOnly: boolean, controller: AbortController) => {
    const startResponse = await fetch(`${API_BASE}/ai/${marca}/fix-design-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!startResponse.ok) throw new Error(`HTTP ${startResponse.status}`);
    const startJson = await startResponse.json() as { data?: { jobId?: string } };
    const jobId = startJson.data?.jobId;
    if (!jobId) throw new Error('Job de revisão não retornado');

    const streamResponse = await fetch(`${API_BASE}/ai/fix-jobs/${jobId}/stream`, {
      headers: { ...getAuthHeaders() },
      signal: controller.signal,
    });
    if (!streamResponse.ok) throw new Error(`HTTP ${streamResponse.status}`);
    await consumeSse(streamResponse, planOnly);
  }, [consumeSse]);

  const startFix = useCallback(async (pages: DesignPage[], marca: string) => {
    abort();
    setPhase('analyzing');
    setIssues([]);
    setFixList([]);
    setSelectedFixIds(new Set());
    setRemainingIssues([]);
    setCorrectedPages(null);
    setIteration(1);
    setErrorMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await startFixJob(marca, {
        currentPages: pages,
        canvasWidth: pages[0]?.width ?? 1080,
        canvasHeight: pages[0]?.height ?? 1080,
      }, false, controller);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMessage(err instanceof Error ? err.message : 'Falha na conexão com o servidor');
      setPhase('error');
    }
  }, [abort, startFixJob]);

  const startPlanOnly = useCallback(async (pages: DesignPage[], marca: string) => {
    abort();
    setPhase('analyzing');
    setIssues([]);
    setFixList([]);
    setSelectedFixIds(new Set());
    setRemainingIssues([]);
    setCorrectedPages(null);
    setIteration(1);
    setErrorMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await startFixJob(marca, {
        currentPages: pages,
        canvasWidth: pages[0]?.width ?? 1080,
        canvasHeight: pages[0]?.height ?? 1080,
        planOnly: true,
      }, true, controller);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMessage(err instanceof Error ? err.message : 'Falha na conexão com o servidor');
      setPhase('error');
    }
  }, [abort, startFixJob]);

  const toggleFix = useCallback((fixId: string) => {
    setSelectedFixIds(prev => {
      const next = new Set(prev);
      if (next.has(fixId)) {
        next.delete(fixId);
        return next;
      }
      
      next.add(fixId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFixIds(new Set(fixList.map(fs => fs.fix.id)));
  }, [fixList]);

  const selectNone = useCallback(() => setSelectedFixIds(new Set()), []);

  const applySelected = useCallback(async (pages: DesignPage[], marca: string) => {
    const selected = fixList.filter(fs => selectedFixIds.has(fs.fix.id)).map(fs => fs.fix);
    if (selected.length === 0) return;

    abort();
    setPhase('executing');
    setRemainingIssues([]);
    setCorrectedPages(null);
    setErrorMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await startFixJob(marca, {
        currentPages: pages,
        canvasWidth: pages[0]?.width ?? 1080,
        canvasHeight: pages[0]?.height ?? 1080,
        selectedFixes: selected,
      }, false, controller);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMessage(err instanceof Error ? err.message : 'Falha na conexão com o servidor');
      setPhase('error');
    }
  }, [abort, fixList, selectedFixIds, startFixJob]);

  return {
    phase,
    issues,
    fixList,
    selectedFixIds,
    remainingIssues,
    verifyWarning,
    correctedPages,
    iteration,
    errorMessage,
    startFix,
    startPlanOnly,
    toggleFix,
    selectAll,
    selectNone,
    applySelected,
    abort,
    reset,
  };
}
