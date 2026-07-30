import { describe, it, expect } from 'vitest';
import { formatTokens } from './aiUsageFormat';

describe('formatTokens', () => {
  it('formats numbers less than 1,000 without suffixes', () => {
    expect(formatTokens(900)).toBe('900');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats numbers between 1,000 and 999,999 with "mil" suffix', () => {
    expect(formatTokens(1000)).toBe('1 mil');
    expect(formatTokens(1234)).toBe('1,2 mil');
    expect(formatTokens(12345)).toBe('12,3 mil');
    expect(formatTokens(999999)).toBe('1.000 mil'); // (999999/1000).toLocaleString(...) maximumFractionDigits: 1
  });

  it('formats numbers 1,000,000 and above with "M" suffix', () => {
    expect(formatTokens(1000000)).toBe('1 M');
    expect(formatTokens(1234000)).toBe('1,23 M');
    expect(formatTokens(1234567)).toBe('1,23 M');
    expect(formatTokens(10000000)).toBe('10 M');
  });

  it('handles edge case: zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('handles edge case: negative numbers gracefully', () => {
    // Current implementation falls back to the default case
    // return n.toLocaleString('pt-BR');
    expect(formatTokens(-100)).toBe('-100');
    expect(formatTokens(-1000)).toBe('-1.000');
    expect(formatTokens(-1234567)).toBe('-1.234.567');
  });
});
