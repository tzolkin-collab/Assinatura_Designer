import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import { generateDesign, type Layer, type TextZonesPerSlide } from './nanoBanana.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ── Types ─────────────────────────────────────────────────────────────────────

export type IssueType =
  | 'layer-overlap'
  | 'color-contrast'
  | 'off-canvas'
  | 'text-overflow'
  | 'visual-hierarchy'
  | 'color-inconsistency'
  | 'empty-content';

export type IssueSeverity = 'critical' | 'major' | 'minor';

export interface DesignIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  description: string;
  affectedLayerIds: string[];
  slideIndex: number;
  suggestedFix: string;
}

export type FixStrategy =
  | 'reposition'
  | 'resize'
  | 'recolor'
  | 'rewrite'
  | 'adjust-opacity'
  | 'adjust-zindex'
  | 'regenerate-visual';

export interface DesignFix {
  id: string;
  issueId: string;
  priority: number;
  strategy: FixStrategy;
  description: string;
  slideIndex: number;
  affectedLayerIds: string[];
  rationale: string;
  isReactive?: boolean;
}

export interface FixPatch {
  layerId: string;
  slideIndex: number;
  overrides: Partial<Layer> & { _delete?: boolean };
}

export interface FixExecution {
  fixId: string;
  success: boolean;
  patches: FixPatch[];
  explanation: string;
  confidence: number;
  newIssues: DesignIssue[];
}

export type FixerEventType =
  | 'analyze-start'
  | 'analyze-done'
  | 'plan-done'
  | 'iteration-start'
  | 'fix-start'
  | 'fix-done'
  | 'fix-added'
  | 'verify-start'
  | 'verify-done'
  | 'complete'
  | 'error'
  | 'user-input-needed'
  | 'user-input-received'
  | 'memory-update'
  | 'log';

export interface FixerEvent {
  type: FixerEventType;
  issues?: DesignIssue[];
  fixes?: DesignFix[];
  fix?: DesignFix;
  execution?: FixExecution;
  remaining?: DesignIssue[];
  pages?: unknown[];
  iteration?: number;
  message?: string;
  question?: string;
  options?: string[];
  input?: string;
  memory?: string;
}

export interface FixerPage {
  backgroundColor?: string;
  backgroundImage?: string;
  layers?: Layer[];
  width?: number;
  height?: number;
}

// Context object passed to fixDesign — decouples orchestration from job store
export interface FixJobContext {
  emit: (event: FixerEvent) => void;
  getMemory: () => string;
  addMemory: (entry: string) => void;
  triedFixes: Map<string, Set<string>>;
  isAutoMode: () => boolean;
  setAutoMode: () => void;
  isCancelled: () => boolean;
  waitForInput: (question: string, options?: string[]) => Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function issueFingerprint(issue: DesignIssue): string {
  return `${issue.type}|${[...issue.affectedLayerIds].sort().join(',')}|${issue.slideIndex}`;
}

function hasBeenTried(triedFixes: Map<string, Set<string>>, issue: DesignIssue, strategy: string): boolean {
  return triedFixes.get(issueFingerprint(issue))?.has(strategy) ?? false;
}

function markTried(triedFixes: Map<string, Set<string>>, issue: DesignIssue, strategy: string): void {
  const fp = issueFingerprint(issue);
  if (!triedFixes.has(fp)) triedFixes.set(fp, new Set());
  triedFixes.get(fp)!.add(strategy);
}

// Applies patches to a single slide — safe for parallel slide execution
function applyPatchesToSlide(slide: FixerPage, patches: FixPatch[]): FixerPage {
  let result: FixerPage = { ...slide, layers: [...(slide.layers ?? [])] };
  for (const patch of patches) {
    if (patch.layerId.startsWith('__new__')) {
      const newLayer = { ...patch.overrides, id: patch.layerId.slice(7) } as Layer;
      result = { ...result, layers: [...(result.layers ?? []), newLayer] };
      continue;
    }
    
    if ((patch.overrides as Record<string, unknown>)._delete) {
      result = { ...result, layers: (result.layers ?? []).filter(l => l.id !== patch.layerId) };
      continue;
    }
    
    result = { ...result, layers: (result.layers ?? []).map(l => l.id === patch.layerId ? { ...l, ...patch.overrides } : l) };
  }
  return result;
}

// ── Serialize design for AI ───────────────────────────────────────────────────

function serialize(pages: FixerPage[], dims: { width: number; height: number }, brandColors: string[]) {
  return {
    canvas: dims,
    brandColors,
    slides: pages.map((page, i) => ({
      index: i,
      backgroundColor: page.backgroundColor ?? '#ffffff',
      layers: (page.layers ?? []).filter(Boolean).map(l => ({
        id: l.id,
        type: l.type,
        rect: { x: l.x, y: l.y, x2: l.x + l.width, y2: l.y + l.height },
        zIndex: l.zIndex ?? 0,
        color: l.color,
        opacity: l.opacity ?? 1,
        fontSize: l.fontSize,
        content: l.type === 'text' ? (l.content ?? '').slice(0, 80) : undefined,
      })),
    })),
  };
}

// ── Phase 1: Analyze ──────────────────────────────────────────────────────────

async function analyzeDesign(
  pages: FixerPage[],
  dims: { width: number; height: number },
  brandColors: string[],
  brandContext: string,
  sessionMemory?: string,
): Promise<DesignIssue[]> {
  const data = JSON.stringify(serialize(pages, dims, brandColors), null, 2);

  const memSection = sessionMemory
    ? `\n\nHistórico desta sessão (NÃO repita problemas que já foram tratados com sucesso; foque no que persiste):\n${sessionMemory}`
    : '';

  const prompt = `Você é um auditor sênior de qualidade de design para apresentações visuais. Analise este design JSON e identifique TODOS os problemas que afetam a qualidade final.

Contexto da marca:
${brandContext}

Design atual (coordenadas em pixels, rect.x2 = x + width, rect.y2 = y + height):
${data}

Critérios de auditoria — VERIFIQUE TODOS:

1. SOBREPOSIÇÃO (layer-overlap) — critical/major:
   Dois layers com rects que se intersectam E zIndex próximos (diferença < 5), onde nenhum é fundo intencional.
   Fórmula: A.x < B.x2 && A.x2 > B.x && A.y < B.y2 && A.y2 > B.y

2. CONTRASTE (color-contrast) — critical/major:
   Texto com baixo contraste em relação ao fundo. Estime luminosidade relativa pelos valores HEX.
   Um texto claro (#fff, #f0f0f0) sobre fundo claro é crítico.

3. FORA DO CANVAS (off-canvas) — critical:
   rect.x < 0, rect.y < 0, rect.x2 > ${dims.width}, rect.y2 > ${dims.height}.

4. OVERFLOW DE TEXTO (text-overflow) — major:
   Altura do layer de texto < fontSize × 1.2 (menos de 1 linha visível).

5. HIERARQUIA VISUAL (visual-hierarchy) — minor:
   Todos os layers de texto com fontSize idêntico em um slide — sem diferenciação título/corpo.

6. CORES INCONSISTENTES (color-inconsistency) — minor:
   Cores que não pertencem à paleta da marca nem são variações dela: ${brandColors.join(', ')}.

7. CONTEÚDO VAZIO (empty-content) — major:
   Texto vazio, "Novo Texto", "placeholder", "Lorem ipsum" ou genérico sem significado.
${memSection}

Retorne APENAS JSON válido. Seja específico — identifique o ID exato dos layers:
{
  "issues": [
    {
      "id": "uuid",
      "type": "layer-overlap|color-contrast|off-canvas|text-overflow|visual-hierarchy|color-inconsistency|empty-content",
      "severity": "critical|major|minor",
      "description": "Descrição clara em português do problema específico com IDs dos layers",
      "affectedLayerIds": ["id1", "id2"],
      "slideIndex": 0,
      "suggestedFix": "Ação concreta e específica para corrigir"
    }
  ]
}`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(response.text ?? '{"issues":[]}') as { issues?: unknown[] };
  const raw = Array.isArray(parsed.issues) ? parsed.issues : [];

  return raw.map((i: unknown) => {
    const issue = i as Record<string, unknown>;
    return {
      id: typeof issue.id === 'string' && issue.id ? issue.id : randomUUID(),
      type: (issue.type as IssueType) ?? 'layer-overlap',
      severity: (issue.severity as IssueSeverity) ?? 'minor',
      description: typeof issue.description === 'string' ? issue.description : '',
      affectedLayerIds: Array.isArray(issue.affectedLayerIds) ? issue.affectedLayerIds as string[] : [],
      slideIndex: typeof issue.slideIndex === 'number' ? issue.slideIndex : 0,
      suggestedFix: typeof issue.suggestedFix === 'string' ? issue.suggestedFix : '',
    } satisfies DesignIssue;
  });
}

// ── Phase 2: Plan ─────────────────────────────────────────────────────────────

async function planFixes(
  issues: DesignIssue[],
  brandColors: string[],
  dims: { width: number; height: number },
  sessionMemory?: string,
): Promise<DesignFix[]> {
  if (issues.length === 0) return [];

  const memSection = sessionMemory
    ? `\n\nHistórico de tentativas desta sessão (EVITE repetir estratégias que já falharam):\n${sessionMemory}`
    : '';

  const prompt = `Você é um diretor de design. Crie um plano de correção ordenado por impacto visual.

Problemas identificados:
${JSON.stringify(issues, null, 2)}

Paleta da marca: ${brandColors.join(', ')}
Canvas: ${dims.width}×${dims.height}px
${memSection}

Estratégias disponíveis — escolha a menos invasiva que resolve o problema:
- reposition: alterar x, y (mover o layer)
- resize: alterar width, height
- recolor: mudar color para cor da paleta com bom contraste
- rewrite: reescrever content de texto
- adjust-opacity: alterar opacity
- adjust-zindex: alterar zIndex para corrigir ordem de sobreposição
- regenerate-visual: regenerar TODOS os elementos visuais (shapes/images) do slide via NanoBanana — somente para problemas globais

Prioridade: critical → priority 1–9 | major → 10–49 | minor → 50+

Retorne APENAS JSON:
{
  "fixes": [
    {
      "id": "uuid",
      "issueId": "id-do-problema",
      "priority": number,
      "strategy": "reposition|resize|recolor|rewrite|adjust-opacity|adjust-zindex|regenerate-visual",
      "description": "O que exatamente será feito",
      "slideIndex": 0,
      "affectedLayerIds": ["id1"],
      "rationale": "Por que esta estratégia resolve o problema"
    }
  ]
}`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(response.text ?? '{"fixes":[]}') as { fixes?: unknown[] };
  const raw = Array.isArray(parsed.fixes) ? parsed.fixes : [];

  return raw
    .map((f: unknown) => {
      const fix = f as Record<string, unknown>;
      return {
        id: typeof fix.id === 'string' && fix.id ? fix.id : randomUUID(),
        issueId: typeof fix.issueId === 'string' ? fix.issueId : '',
        priority: typeof fix.priority === 'number' ? fix.priority : 50,
        strategy: (fix.strategy as FixStrategy) ?? 'reposition',
        description: typeof fix.description === 'string' ? fix.description : '',
        slideIndex: typeof fix.slideIndex === 'number' ? fix.slideIndex : 0,
        affectedLayerIds: Array.isArray(fix.affectedLayerIds) ? fix.affectedLayerIds as string[] : [],
        rationale: typeof fix.rationale === 'string' ? fix.rationale : '',
      } satisfies DesignFix;
    })
    .sort((a, b) => a.priority - b.priority);
}

// ── Phase 3a: Execute layer-level fix ────────────────────────────────────────

async function executeLayerFix(
  fix: DesignFix,
  pages: FixerPage[],
  brandColors: string[],
  dims: { width: number; height: number },
  sessionMemory?: string,
): Promise<{ patches: FixPatch[]; explanation: string; confidence: number }> {
  const slide = pages[fix.slideIndex];
  if (!slide) return { patches: [], explanation: 'Slide não encontrado', confidence: 0 };

  const affectedLayers = (slide.layers ?? []).filter(l => fix.affectedLayerIds.includes(l.id));
  const allLayers = (slide.layers ?? []).filter(Boolean);

  const memSection = sessionMemory
    ? `\nContexto da sessão (evite repetir o que já falhou):\n${sessionMemory}\n`
    : '';

  const prompt = `Execute esta correção de design com precisão absoluta.

Fix: ${fix.description}
Estratégia: ${fix.strategy}
Racional: ${fix.rationale}
${memSection}
Layers afetados:
${JSON.stringify(affectedLayers.map(l => ({
    id: l.id, type: l.type,
    rect: { x: l.x, y: l.y, w: l.width, h: l.height },
    color: l.color, opacity: l.opacity,
    fontSize: l.fontSize, zIndex: l.zIndex,
    content: l.content,
  })), null, 2)}

Todos os layers do slide (contexto espacial):
${JSON.stringify(allLayers.map(l => ({
    id: l.id, type: l.type,
    rect: { x: l.x, y: l.y, x2: l.x + l.width, y2: l.y + l.height },
    zIndex: l.zIndex, color: l.color, opacity: l.opacity ?? 1,
  })), null, 2)}

Canvas: ${dims.width}×${dims.height}px | Margem segura: 60px de cada borda
Fundo do slide: ${slide.backgroundColor ?? '#fff'}
Paleta da marca: ${brandColors.join(', ')}

Instruções por estratégia:
- reposition: novos x, y dentro da área segura (mín 60px de margem em cada lado)
- resize: novos width, height — não ultrapasse o canvas; mantenha proporção de texto
- recolor: cor #HEX da paleta que maximiza contraste com o fundo do slide
- rewrite: texto em português, mesmo contexto/tom do original, sem placeholder
- adjust-opacity: opacity 0.0–1.0 — resolve visibilidade ou sobreposição
- adjust-zindex: zIndex que corrija a ordem sem conflitar com outros layers

Retorne APENAS JSON:
{
  "patches": [{ "layerId": "id", "overrides": { /* APENAS os campos alterados */ } }],
  "explanation": "O que foi alterado e por que resolve o problema",
  "confidence": 0.0-1.0
}`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(response.text ?? '{"patches":[],"explanation":"","confidence":0}') as {
    patches?: unknown[];
    explanation?: string;
    confidence?: number;
  };

  const patches = (Array.isArray(parsed.patches) ? parsed.patches : [])
    .map((p: unknown) => {
      const patch = p as Record<string, unknown>;
      return {
        layerId: typeof patch.layerId === 'string' ? patch.layerId : '',
        slideIndex: fix.slideIndex,
        overrides: (typeof patch.overrides === 'object' && patch.overrides ? patch.overrides : {}) as Partial<Layer>,
      };
    })
    .filter(p => p.layerId);

  return {
    patches,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
  };
}

// ── Phase 3b: Execute visual regeneration via NanoBanana ─────────────────────

async function executeVisualRegeneration(
  fix: DesignFix,
  pages: FixerPage[],
  brandColors: string[],
  dims: { width: number; height: number },
  brandContext: string,
): Promise<{ patches: FixPatch[]; explanation: string; confidence: number }> {
  const slide = pages[fix.slideIndex];
  if (!slide) return { patches: [], explanation: 'Slide não encontrado', confidence: 0 };

  const textLayers = (slide.layers ?? []).filter(l => l.type === 'text');
  const textZones: TextZonesPerSlide = [{
    slide: 0,
    zones: textLayers.map(l => ({ id: l.id, x: l.x, y: l.y, w: l.width, h: l.height, color: l.color })),
  }];

  const designSlides = await generateDesign(
    `Corrija os problemas visuais: ${fix.description}. ${fix.rationale}`,
    `${brandContext}\nSlides: 1\nCores da marca: ${brandColors.join(', ')}`,
    'single',
    dims,
    undefined,
    undefined,
    undefined,
    textZones,
  );

  const newVisualLayers = (designSlides[0]?.layers ?? []).filter(l => l.type !== 'text');

  const deletePatches: FixPatch[] = (slide.layers ?? [])
    .filter(l => l.type !== 'text')
    .map(l => ({ layerId: l.id, slideIndex: fix.slideIndex, overrides: { _delete: true } as Partial<Layer> }));

  const addPatches: FixPatch[] = newVisualLayers.map(l => ({
    layerId: `__new__${l.id}`,
    slideIndex: fix.slideIndex,
    overrides: l as Partial<Layer>,
  }));

  return {
    patches: [...deletePatches, ...addPatches],
    explanation: `Regenerados ${newVisualLayers.length} elementos visuais com NanoBanana`,
    confidence: 0.78,
  };
}

// ── Apply patches (full pages array) ─────────────────────────────────────────

function _applyPatches(pages: FixerPage[], patches: FixPatch[]): FixerPage[] {
  const result: FixerPage[] = pages.map(p => ({ ...p, layers: [...(p.layers ?? [])] }));

  const bySlide = new Map<number, FixPatch[]>();
  for (const patch of patches) {
    const list = bySlide.get(patch.slideIndex) ?? [];
    list.push(patch);
    bySlide.set(patch.slideIndex, list);
  }

  for (const [idx, slidePatches] of bySlide) {
    const slide = result[idx];
    if (!slide) continue;
    result[idx] = applyPatchesToSlide(slide, slidePatches);
  }

  return result;
}

// ── Mini-verify ───────────────────────────────────────────────────────────────

async function miniVerify(
  fix: DesignFix,
  pages: FixerPage[],
  issue: DesignIssue,
  dims: { width: number; height: number },
  brandColors: string[],
): Promise<{ resolved: boolean; newIssues: DesignIssue[] }> {
  const slide = pages[fix.slideIndex];
  if (!slide) return { resolved: false, newIssues: [] };

  const affectedSet = new Set(fix.affectedLayerIds);
  const contextLayers = (slide.layers ?? []).filter(l => {
    if (affectedSet.has(l.id)) return true;
    const affected = (slide.layers ?? []).find(a => affectedSet.has(a.id));
    if (!affected) return false;
    return Math.abs(l.x - affected.x) < 400 && Math.abs(l.y - affected.y) < 400;
  });

  const prompt = `Verifique se a correção resolveu o problema E se introduziu novos problemas.

Problema original: "${issue.description}"
Correção aplicada: "${fix.description}"

Estado atual das camadas relevantes:
${JSON.stringify(contextLayers.map(l => ({
    id: l.id, type: l.type,
    rect: { x: l.x, y: l.y, x2: l.x + l.width, y2: l.y + l.height },
    color: l.color, opacity: l.opacity ?? 1, fontSize: l.fontSize, zIndex: l.zIndex ?? 0,
  })), null, 2)}

Canvas: ${dims.width}×${dims.height}px | Fundo: ${slide.backgroundColor} | Paleta: ${brandColors.join(', ')}

Retorne APENAS JSON:
{
  "resolved": true|false,
  "newIssues": [
    {
      "type": "layer-overlap|color-contrast|off-canvas|text-overflow|visual-hierarchy|color-inconsistency|empty-content",
      "severity": "critical|major|minor",
      "description": "Novo problema introduzido",
      "affectedLayerIds": ["id1"],
      "suggestedFix": "Como corrigir"
    }
  ]
}`;

  const response = await generateWithRetry(ai, {
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(response.text ?? '{"resolved":true,"newIssues":[]}') as {
    resolved?: boolean;
    newIssues?: unknown[];
  };

  const newIssues = (Array.isArray(parsed.newIssues) ? parsed.newIssues : [])
    .map((n: unknown) => {
      const ni = n as Record<string, unknown>;
      return {
        id: randomUUID(),
        type: (ni.type as IssueType) ?? 'layer-overlap',
        severity: (ni.severity as IssueSeverity) ?? 'minor',
        description: typeof ni.description === 'string' ? ni.description : '',
        affectedLayerIds: Array.isArray(ni.affectedLayerIds) ? ni.affectedLayerIds as string[] : fix.affectedLayerIds,
        slideIndex: fix.slideIndex,
        suggestedFix: typeof ni.suggestedFix === 'string' ? ni.suggestedFix : '',
      } satisfies DesignIssue;
    });

  return { resolved: parsed.resolved === true, newIssues };
}

// ── Strategy alternatives ─────────────────────────────────────────────────────

const ALT_STRATEGY: Partial<Record<FixStrategy, FixStrategy>> = {
  reposition: 'resize',
  resize: 'reposition',
  recolor: 'adjust-opacity',
  'adjust-opacity': 'recolor',
  'adjust-zindex': 'reposition',
};

// ── Main orchestrator ─────────────────────────────────────────────────────────

export interface FixDesignOptions {
  /** Stop after analyze + plan; emit complete with original pages. */
  planOnly?: boolean;
  /** Skip analyze + plan; execute only these pre-approved fixes. */
  selectedFixes?: DesignFix[];
  maxIterations?: number;
}

export async function fixDesign(
  ctx: FixJobContext,
  pages: FixerPage[],
  brandColors: string[],
  dims: { width: number; height: number },
  brandContext: string,
  options: FixDesignOptions | number = {},
): Promise<FixerPage[]> {
  // Back-compat: old callers may pass maxIterations as a number
  const opts: FixDesignOptions = typeof options === 'number' ? { maxIterations: options } : options;
  const maxIterations = opts.maxIterations ?? 2;

  // Working copy — mutated in place by parallel slide tasks
  const workingPages: FixerPage[] = pages.map(p => ({ ...p, layers: [...(p.layers ?? [])] }));

  // ── planOnly mode: analyze + plan, then return original pages unchanged ──────
  if (opts.planOnly) {
    ctx.emit({ type: 'analyze-start' });
    // Sem `try` aqui de propósito: análise que falha não é design sem problemas.
    // Engolir a exceção e seguir com `issues = []` fazia a UI anunciar que estava
    // tudo certo justamente quando ninguém tinha olhado. Os dois callers já sabem
    // falhar o job (failFixJob / evento `error`), então deixamos subir.
    const issues: DesignIssue[] = await analyzeDesign(workingPages, dims, brandColors, brandContext);
    ctx.emit({ type: 'analyze-done', issues });

    // Idem: há problemas conhecidos e o plano falhou — `fixes = []` seria dizer
    // "nada a corrigir" para uma lista de defeitos que acabamos de listar.
    let fixes: DesignFix[] = [];
    if (issues.length > 0) {
      fixes = await planFixes(issues, brandColors, dims);
    }
    ctx.emit({ type: 'plan-done', fixes });
    ctx.emit({ type: 'complete', pages: workingPages as unknown[] });
    return workingPages;
  }

  // ── selectedFixes mode: skip analyze+plan, execute approved fixes only ────────
  if (opts.selectedFixes && opts.selectedFixes.length > 0) {
    const bySlide = new Map<number, DesignFix[]>();
    for (const fix of opts.selectedFixes) {
      const list = bySlide.get(fix.slideIndex) ?? [];
      list.push(fix);
      bySlide.set(fix.slideIndex, list);
    }
    ctx.emit({ type: 'plan-done', fixes: opts.selectedFixes });

    await Promise.all(
      [...bySlide.entries()].map(async ([slideIdx, slideFixes]) => {
        for (const fix of slideFixes) {
          if (ctx.isCancelled()) return;
          ctx.emit({ type: 'fix-start', fix });
          let result: { patches: FixPatch[]; explanation: string; confidence: number };
          try {
            result = fix.strategy === 'regenerate-visual'
              ? await executeVisualRegeneration(fix, workingPages, brandColors, dims, brandContext)
              : await executeLayerFix(fix, workingPages, brandColors, dims);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro na execução';
            ctx.emit({ type: 'fix-done', fix, execution: { fixId: fix.id, success: false, patches: [], explanation: msg, confidence: 0, newIssues: [] } });
            continue;
          }
          if (result.patches.length > 0) {
            const slidePatches = result.patches.filter(p => p.slideIndex === slideIdx);
            if (slidePatches.length > 0) workingPages[slideIdx] = applyPatchesToSlide(workingPages[slideIdx]!, slidePatches);
          }
          ctx.emit({ type: 'fix-done', fix, execution: { fixId: fix.id, success: result.patches.length > 0, patches: result.patches, explanation: result.explanation, confidence: result.confidence, newIssues: [] } });
        }
      })
    );

    ctx.emit({ type: 'verify-start', iteration: 1 });
    // Aqui os fixes já foram aplicados: deixar a exceção subir jogaria fora trabalho
    // real do usuário. Mas "não consegui verificar" também não é "está tudo certo" —
    // antes, o catch zerava `remaining` e a UI cravava "✅ Design corrigido!" sem
    // ninguém ter conferido. Entregamos as páginas e admitimos que não sabemos.
    let remaining: DesignIssue[] = [];
    let verifyFailure: string | undefined;
    try {
      const all = await analyzeDesign(workingPages, dims, brandColors, brandContext);
      remaining = all.filter(i => i.severity !== 'minor');
    } catch (err) {
      verifyFailure = err instanceof Error ? err.message : 'erro desconhecido';
    }
    ctx.emit({ type: 'verify-done', remaining, iteration: 1, message: verifyFailure });
    ctx.emit({ type: 'complete', pages: workingPages as unknown[] });
    return workingPages;
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.isCancelled()) break;

    ctx.emit({ type: 'iteration-start', iteration });

    // ── Phase 1: Analyze all slides ────────────────────────────────────────
    ctx.emit({ type: 'analyze-start' });
    let issues: DesignIssue[];
    try {
      issues = await analyzeDesign(workingPages, dims, brandColors, brandContext, ctx.getMemory() || undefined);
    } catch {
      issues = [];
    }
    ctx.emit({ type: 'analyze-done', issues });

    if (issues.length === 0) break;

    // ── Checkpoint: approval (skip if autoMode) ────────────────────────────
    if (!ctx.isAutoMode()) {
      const critCount = issues.filter(i => i.severity === 'critical').length;
      ctx.emit({
        type: 'user-input-needed',
        question: `Encontrei ${issues.length} problema${issues.length !== 1 ? 's' : ''} (${critCount} crítico${critCount !== 1 ? 's' : ''}). Prosseguir?`,
        options: ['Sim, corrigir', '/auto — Sem pausas', '/stop — Cancelar'],
      });
      const reply = await ctx.waitForInput('Prosseguir?', ['Sim', '/auto', '/stop']);
      ctx.emit({ type: 'user-input-received', input: reply });
      if (reply === '/stop' || ctx.isCancelled()) break;
      if (reply === '/auto') ctx.setAutoMode();
    }

    // ── Phase 2: Plan — filtered to skip already-tried strategies ──────────
    let fixes: DesignFix[];
    try {
      const raw = await planFixes(issues, brandColors, dims, ctx.getMemory() || undefined);
      fixes = raw.filter(f => {
        const matchingIssue = issues.find(i => i.id === f.issueId);
        return !matchingIssue || !hasBeenTried(ctx.triedFixes, matchingIssue, f.strategy);
      });
    } catch {
      fixes = [];
    }
    ctx.emit({ type: 'plan-done', fixes });

    if (fixes.length === 0) break;

    // ── Phase 3: Execute in parallel by slide ─────────────────────────────
    const issueMap = new Map(issues.map(i => [i.id, i]));

    // Group fixes by slide
    const bySlide = new Map<number, DesignFix[]>();
    for (const fix of fixes) {
      const list = bySlide.get(fix.slideIndex) ?? [];
      list.push(fix);
      bySlide.set(fix.slideIndex, list);
    }

    // Each slide runs its fix queue concurrently with other slides
    await Promise.all(
      [...bySlide.entries()].map(async ([slideIdx, slideFixes]) => {
        const queue = [...slideFixes];
        let qi = 0;

        while (qi < queue.length) {
          if (ctx.isCancelled()) return;

          const fix = queue[qi++];
          if (!fix) continue;

          ctx.emit({ type: 'fix-start', fix });

          // ── ACTION ────────────────────────────────────────────────────────
          let result: { patches: FixPatch[]; explanation: string; confidence: number } = { patches: [], explanation: '', confidence: 0 };
          try {
            if (fix.strategy === 'regenerate-visual') {
              result = await executeVisualRegeneration(fix, workingPages, brandColors, dims, brandContext);
            }
            if (fix.strategy !== 'regenerate-visual') {
              result = await executeLayerFix(fix, workingPages, brandColors, dims, ctx.getMemory() || undefined);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro na execução';
            ctx.emit({ type: 'fix-done', fix, execution: { fixId: fix.id, success: false, patches: [], explanation: msg, confidence: 0, newIssues: [] } });
            continue;
          }

          if (result.patches.length === 0) {
            ctx.emit({ type: 'fix-done', fix, execution: { fixId: fix.id, success: false, patches: [], explanation: result.explanation || 'Sem patches', confidence: 0, newIssues: [] } });
            continue;
          }

          // Apply patches to this slide only (JS single-threaded → no race condition)
          const slidePatches = result.patches.filter(p => p.slideIndex === slideIdx);
          if (slidePatches.length > 0) {
            workingPages[slideIdx] = applyPatchesToSlide(workingPages[slideIdx]!, slidePatches);
          }

          // ── ANALYSIS (mini-verify, only for uncertain fixes) ───────────────
          const originalIssue = issueMap.get(fix.issueId);
          let newIssues: DesignIssue[] = [];
          let resolved = true;

          if (originalIssue && result.confidence < 0.9 && fix.strategy !== 'regenerate-visual') {
            try {
              const verif = await miniVerify(fix, workingPages, originalIssue, dims, brandColors);
              resolved = verif.resolved;
              newIssues = verif.newIssues;
            } catch {
              // assume resolved on error
            }
          }

          // Track tried strategy to prevent repetition
          if (originalIssue) markTried(ctx.triedFixes, originalIssue, fix.strategy);

          // Update rolling memory
          ctx.addMemory(
            `Slide ${slideIdx}, ${fix.affectedLayerIds.join('+')} [${fix.strategy}]: ${resolved ? '✓ SUCESSO' : '✗ FALHOU'} (conf ${Math.round((result.confidence) * 100)}%)`
          );

          // ── REACTION A: new issues → add reactive fixes to this slide's queue
          if (newIssues.length > 0) {
            try {
              const reactFixes = await planFixes(newIssues, brandColors, dims, ctx.getMemory());
              for (const rf of reactFixes) {
                const reactive: DesignFix = { ...rf, id: randomUUID(), slideIndex: slideIdx, isReactive: true };
                queue.push(reactive);
                ctx.emit({ type: 'fix-added', fix: reactive });
              }
            } catch { /* continue without reactive fixes */ }
          }

          // ── REACTION B: fix failed → try alternative strategy (once only)
          if (!resolved && !fix.isReactive && originalIssue) {
            const alt = ALT_STRATEGY[fix.strategy];
            if (alt && !hasBeenTried(ctx.triedFixes, originalIssue, alt)) {
              const altFix: DesignFix = {
                ...fix,
                id: randomUUID(),
                strategy: alt,
                description: `[Alt] ${fix.description}`,
                rationale: `${fix.strategy} falhou → tentando ${alt}`,
                isReactive: true,
              };
              queue.splice(qi, 0, altFix); // insert immediately next
              ctx.emit({ type: 'fix-added', fix: altFix });
            }
          }

          ctx.emit({
            type: 'fix-done', fix,
            execution: {
              fixId: fix.id,
              success: resolved || result.confidence > 0.7,
              patches: result.patches,
              explanation: result.explanation,
              confidence: result.confidence,
              newIssues,
            },
          });
        }
      })
    );

    if (ctx.isCancelled()) break;

    // ── Phase 4: Full verify ────────────────────────────────────────────────
    ctx.emit({ type: 'verify-start', iteration });
    let remaining: DesignIssue[] = [];
    try {
      const all = await analyzeDesign(workingPages, dims, brandColors, brandContext, ctx.getMemory());
      remaining = all.filter(i => i.severity !== 'minor');
    } catch {
      remaining = [];
    }
    ctx.emit({ type: 'verify-done', remaining, iteration });

    // Emit memory snapshot
    if (ctx.getMemory()) {
      ctx.emit({ type: 'memory-update', memory: ctx.getMemory() });
    }

    // ── Checkpoint: continue? (if not autoMode and not last iteration) ──────
    if (!ctx.isAutoMode() && remaining.length > 0 && iteration < maxIterations) {
      ctx.emit({
        type: 'user-input-needed',
        question: `Iteração ${iteration} concluída. Ainda há ${remaining.length} problema${remaining.length !== 1 ? 's' : ''} significativo${remaining.length !== 1 ? 's' : ''}. Mais uma rodada?`,
        options: ['Sim, continuar', '/auto — Continuar sem parar', 'Não, encerrar aqui'],
      });
      const reply = await ctx.waitForInput('Continuar?', ['Sim', '/auto', 'Não']);
      ctx.emit({ type: 'user-input-received', input: reply });
      if (reply === '/stop' || reply.toLowerCase().startsWith('n') || ctx.isCancelled()) break;
      if (reply === '/auto') ctx.setAutoMode();
    }

    if (!remaining.some(i => i.severity === 'critical' || i.severity === 'major')) break;
  }

  ctx.emit({ type: 'complete', pages: workingPages as unknown[] });
  return workingPages;
}
