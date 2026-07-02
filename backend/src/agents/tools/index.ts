import { randomUUID } from 'crypto';
import type { DesignPage, DesignLayer } from '../../lib/designTypes.js';
import { updateSession } from '../../lib/redis.js';
import { ws } from '../../lib/websocket.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

type ToolResult = { ok: true; pages: DesignPage[] } | { ok: false; error: string };

// ── Page tools ────────────────────────────────────────────────────────────────

function toolCreatePage(
  pages: DesignPage[],
  args: { backgroundColor?: string; backgroundImage?: string; width?: number; height?: number },
): ToolResult {
  const p = clone(pages);
  p.push({ backgroundColor: args.backgroundColor ?? '#ffffff', backgroundImage: args.backgroundImage, width: args.width, height: args.height, layers: [] });
  return { ok: true, pages: p };
}

function toolUpdatePage(
  pages: DesignPage[],
  args: { pageIndex: number; overrides: Partial<DesignPage> },
): ToolResult {
  const p = clone(pages);
  const page = p[args.pageIndex];
  if (!page) return { ok: false, error: `Page ${args.pageIndex} not found` };
  Object.assign(page, args.overrides);
  return { ok: true, pages: p };
}

function toolDeletePage(pages: DesignPage[], args: { pageIndex: number }): ToolResult {
  const p = clone(pages);
  if (args.pageIndex < 0 || args.pageIndex >= p.length) return { ok: false, error: `Page ${args.pageIndex} not found` };
  p.splice(args.pageIndex, 1);
  return { ok: true, pages: p };
}

function toolReorderPages(pages: DesignPage[], args: { from: number; to: number }): ToolResult {
  const p = clone(pages);
  const [page] = p.splice(args.from, 1);
  if (!page) return { ok: false, error: `Page ${args.from} not found` };
  p.splice(args.to, 0, page);
  return { ok: true, pages: p };
}

// ── Layer tools ───────────────────────────────────────────────────────────────

function toolAddLayer(
  pages: DesignPage[],
  args: { pageIndex: number; layer: Partial<DesignLayer> & { type: DesignLayer['type'] } },
): ToolResult {
  const p = clone(pages);
  const page = p[args.pageIndex];
  if (!page) return { ok: false, error: `Page ${args.pageIndex} not found` };
  if (!page.layers) page.layers = [];
  page.layers.push({ x: 0, y: 0, width: 200, height: 60, zIndex: page.layers.length, ...args.layer, id: args.layer.id ?? randomUUID() } as DesignLayer);
  return { ok: true, pages: p };
}

function toolUpdateLayer(
  pages: DesignPage[],
  args: { pageIndex: number; layerId: string; overrides: Partial<DesignLayer> },
): ToolResult {
  const p = clone(pages);
  const page = p[args.pageIndex];
  if (!page) return { ok: false, error: `Page ${args.pageIndex} not found` };
  const layer = page.layers?.find(l => l.id === args.layerId);
  if (!layer) return { ok: false, error: `Layer ${args.layerId} not found` };
  Object.assign(layer, args.overrides);
  return { ok: true, pages: p };
}

function toolDeleteLayer(
  pages: DesignPage[],
  args: { pageIndex: number; layerId: string },
): ToolResult {
  const p = clone(pages);
  const page = p[args.pageIndex];
  if (!page) return { ok: false, error: `Page ${args.pageIndex} not found` };
  page.layers = page.layers?.filter(l => l.id !== args.layerId) ?? [];
  return { ok: true, pages: p };
}

function toolReorderLayer(
  pages: DesignPage[],
  args: { pageIndex: number; layerId: string; zIndex: number },
): ToolResult {
  const p = clone(pages);
  const layer = p[args.pageIndex]?.layers?.find(l => l.id === args.layerId);
  if (!layer) return { ok: false, error: `Layer ${args.layerId} not found` };
  layer.zIndex = args.zIndex;
  return { ok: true, pages: p };
}

function toolSetDesign(_pages: DesignPage[], args: { pages: DesignPage[] }): ToolResult {
  return { ok: true, pages: args.pages };
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

export type DesignToolName =
  | 'create_page' | 'update_page' | 'delete_page' | 'reorder_pages'
  | 'add_layer' | 'update_layer' | 'delete_layer' | 'reorder_layer'
  | 'set_design';

export async function executeTool(
  tool: DesignToolName,
  args: unknown,
  sessionId: string,
  currentPages: DesignPage[],
): Promise<DesignPage[]> {
  let result: ToolResult;

  switch (tool) {
    case 'create_page':   result = toolCreatePage(currentPages, args as Parameters<typeof toolCreatePage>[1]); break;
    case 'update_page':   result = toolUpdatePage(currentPages, args as Parameters<typeof toolUpdatePage>[1]); break;
    case 'delete_page':   result = toolDeletePage(currentPages, args as Parameters<typeof toolDeletePage>[1]); break;
    case 'reorder_pages': result = toolReorderPages(currentPages, args as Parameters<typeof toolReorderPages>[1]); break;
    case 'add_layer':     result = toolAddLayer(currentPages, args as Parameters<typeof toolAddLayer>[1]); break;
    case 'update_layer':  result = toolUpdateLayer(currentPages, args as Parameters<typeof toolUpdateLayer>[1]); break;
    case 'delete_layer':  result = toolDeleteLayer(currentPages, args as Parameters<typeof toolDeleteLayer>[1]); break;
    case 'reorder_layer': result = toolReorderLayer(currentPages, args as Parameters<typeof toolReorderLayer>[1]); break;
    case 'set_design':    result = toolSetDesign(currentPages, args as Parameters<typeof toolSetDesign>[1]); break;
    default: return currentPages;
  }

  if (!result.ok) {
    console.error(`[Tool ${tool}]`, result.error);
    return currentPages;
  }

  await updateSession(sessionId, { currentDesign: result.pages });
  ws.designUpdate(sessionId, result.pages);

  return result.pages;
}
