import type { AiCost, Currency } from './hooks';

/** 1.234.567 → "1,23 M" · 12.300 → "12,3 mil" · 900 → "900". Curto para caber no widget. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR');
}

export function formatTokensFull(n: number): string {
  return n.toLocaleString('pt-BR');
}

/** Formata um valor monetário na moeda do backend (R$ quando há câmbio, senão US$). */
export function formatMoney(value: number, currency: Currency): string {
  const symbol = currency === 'BRL' ? 'R$' : 'US$';
  return `${symbol} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 })}`;
}

/** "R$ 12,34" quando há valor; "—" quando o custo é zero (preço não configurado). */
export function formatCost(cost: AiCost): string {
  if (cost.total <= 0) return '—';
  return formatMoney(cost.total, cost.currency);
}

/** "2026-07" → "Julho de 2026". */
export function formatMonth(month: string): string {
  const [ano, mes] = month.split('-').map(Number);
  if (!ano || !mes) return month;
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** Nome curto e legível do modelo para a UI. */
export function prettyModel(model: string): string {
  return model
    .replace(/^gemini-/, 'Gemini ')
    .replace(/-preview$/, '')
    .replace(/-/g, ' ');
}
