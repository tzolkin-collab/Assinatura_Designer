import { describe, it, expect } from 'vitest';
import { formatMoney } from './aiUsageFormat';
import type { Currency } from './hooks';

describe('formatMoney', () => {
  it('formats BRL with values >= 1 (2 decimal places)', () => {
    expect(formatMoney(1.5, 'BRL')).toBe('R$ 1,50');
    expect(formatMoney(1234.56, 'BRL')).toBe('R$ 1.234,56');
    expect(formatMoney(1234.564, 'BRL')).toBe('R$ 1.234,56');
    expect(formatMoney(1234.565, 'BRL')).toBe('R$ 1.234,57');
  });

  it('formats USD with values >= 1 (2 decimal places)', () => {
    expect(formatMoney(2.5, 'USD')).toBe('US$ 2,50');
    expect(formatMoney(10.99, 'USD')).toBe('US$ 10,99');
  });

  it('formats values < 1 with up to 4 decimal places', () => {
    expect(formatMoney(0.1234, 'BRL')).toBe('R$ 0,1234');
    expect(formatMoney(0.12344, 'USD')).toBe('US$ 0,1234');
    expect(formatMoney(0.12345, 'BRL')).toBe('R$ 0,1235');
    expect(formatMoney(0.1, 'BRL')).toBe('R$ 0,10');
    expect(formatMoney(0.001, 'USD')).toBe('US$ 0,001');
  });

  it('formats exactly zero correctly', () => {
    expect(formatMoney(0, 'BRL')).toBe('R$ 0,00');
    expect(formatMoney(0, 'USD')).toBe('US$ 0,00');
  });
});
