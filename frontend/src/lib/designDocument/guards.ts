import type { DesignDocument } from './types';

const FORMATS = new Set(['single', 'carousel', 'story', 'presentation']);
const NODE_TYPES = new Set(['container', 'text', 'image', 'shape']);
const DISPLAY_VALUES = new Set(['block', 'flex', 'grid']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isSafeNumber(value) && value > 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function hasRequiredString(record: Record<string, unknown>, key: string) {
  return isString(record[key]) && record[key].trim().length > 0;
}

function hasSafeLayout(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.display !== undefined && (!isString(value.display) || !DISPLAY_VALUES.has(value.display))) return false;
  if (value.width !== undefined && !isNonNegativeSize(value.width)) return false;
  if (value.height !== undefined && !isNonNegativeSize(value.height)) return false;
  if (value.x !== undefined && !isSafeNumber(value.x)) return false;
  if (value.y !== undefined && !isSafeNumber(value.y)) return false;
  if (value.gap !== undefined && (!isSafeNumber(value.gap) || value.gap < 0)) return false;
  return true;
}

function hasSafeInsets(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return isSafeNumber(value.top)
    && isSafeNumber(value.right)
    && isSafeNumber(value.bottom)
    && isSafeNumber(value.left)
    && value.top >= 0
    && value.right >= 0
    && value.bottom >= 0
    && value.left >= 0;
}

function hasSafeZone(value: unknown) {
  if (!isRecord(value)) return false;
  if (!hasRequiredString(value, 'id')) return false;
  if (!isSafeNumber(value.x) || !isSafeNumber(value.y)) return false;
  if (!isPositiveNumber(value.width) || !isPositiveNumber(value.height)) return false;
  if (value.roles !== undefined && (!Array.isArray(value.roles) || !value.roles.every(isString))) return false;
  if (value.nodeIds !== undefined && (!Array.isArray(value.nodeIds) || !value.nodeIds.every(isString))) return false;
  if (value.maxChars !== undefined && !isPositiveNumber(value.maxChars)) return false;
  if (value.allowOverlap !== undefined && typeof value.allowOverlap !== 'boolean') return false;
  return true;
}

function isNonNegativeSize(value: unknown) {
  if (isSafeNumber(value)) return value >= 0;
  if (!isString(value)) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('-')) return false;
  return true;
}

function hasSafeTokens(value: unknown) {
  if (!isRecord(value)) return false;
  const { colors, typography, spacing, radius } = value;
  if (!isRecord(colors) || !isRecord(typography) || !isRecord(spacing) || !isRecord(radius)) return false;
  return hasRequiredString(colors, 'background')
    && hasRequiredString(colors, 'surface')
    && hasRequiredString(colors, 'text')
    && hasRequiredString(colors, 'muted')
    && hasRequiredString(colors, 'accent')
    && hasRequiredString(typography, 'display')
    && hasRequiredString(typography, 'heading')
    && hasRequiredString(typography, 'body')
    && isPositiveNumber(spacing.page)
    && isPositiveNumber(spacing.section)
    && isPositiveNumber(spacing.gap)
    && isPositiveNumber(radius.sm)
    && isPositiveNumber(radius.md)
    && isPositiveNumber(radius.lg);
}

function hasUnsafeCodeFields(value: Record<string, unknown>) {
  return 'html' in value || 'css' in value || 'js' in value || 'script' in value || 'styleTag' in value;
}

function isDesignNode(value: unknown): boolean {
  if (!isRecord(value) || hasUnsafeCodeFields(value)) return false;
  if (!hasRequiredString(value, 'id') || !isString(value.type) || !NODE_TYPES.has(value.type)) return false;

  if (value.type === 'container') {
    return hasSafeLayout(value.layout)
      && Array.isArray(value.children)
      && value.children.every(isDesignNode);
  }

  if (value.type === 'text') {
    return hasRequiredString(value, 'content') && hasSafeLayout(value.layout);
  }

  if (value.type === 'image') {
    return hasRequiredString(value, 'src') && hasSafeLayout(value.layout);
  }

  return hasSafeLayout(value.layout);
}

function isPageNode(value: unknown) {
  if (!isRecord(value) || hasUnsafeCodeFields(value)) return false;
  if (!hasRequiredString(value, 'id') || value.type !== 'page' || !hasRequiredString(value, 'background')) return false;
  if (value.templateId !== undefined && !hasRequiredString(value, 'templateId')) return false;
  if (!hasSafeInsets(value.safeArea) || !hasSafeInsets(value.contentInsets)) return false;
  if (value.textZones !== undefined && (!Array.isArray(value.textZones) || !value.textZones.every(hasSafeZone))) return false;
  if (value.reservedZones !== undefined && (!Array.isArray(value.reservedZones) || !value.reservedZones.every(hasSafeZone))) return false;
  return Array.isArray(value.children)
    && value.children.every(isDesignNode);
}

export function isDesignDocument(value: unknown): value is DesignDocument {
  if (!isRecord(value) || hasUnsafeCodeFields(value)) return false;
  return value.version === 1
    && isString(value.format)
    && FORMATS.has(value.format)
    && isPositiveNumber(value.width)
    && isPositiveNumber(value.height)
    && hasSafeTokens(value.tokens)
    && Array.isArray(value.pages)
    && value.pages.length > 0
    && value.pages.every(isPageNode);
}
