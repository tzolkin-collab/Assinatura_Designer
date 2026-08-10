export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }

  throw new Error('AI response did not contain valid JSON');
}

export function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
