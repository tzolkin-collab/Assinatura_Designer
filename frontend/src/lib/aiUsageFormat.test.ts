import { describe, it, expect } from 'vitest';
import { formatCost } from './aiUsageFormat';

describe('formatCost', () => {
  it('returns "—" when cost.total is 0', () => {
    expect(formatCost({ base: 0, tax: 0, total: 0, currency: 'BRL' })).toBe('—');
  });

  it('returns "—" when cost.total is negative', () => {
    expect(formatCost({ base: -10, tax: 0, total: -10, currency: 'BRL' })).toBe('—');
  });

  it('formats positive cost correctly with BRL currency', () => {
    // 12.34
    expect(formatCost({ base: 10, tax: 2.34, total: 12.34, currency: 'BRL' })).toBe('R$ 12,34');
    expect(formatCost({ base: 1000, tax: 500.5, total: 1500.5, currency: 'BRL' })).toBe('R$ 1.500,50');
  });

  it('formats positive cost correctly with USD currency', () => {
    // 12.34
    expect(formatCost({ base: 10, tax: 2.34, total: 12.34, currency: 'USD' })).toBe('US$ 12,34');
    expect(formatCost({ base: 1000, tax: 500.5, total: 1500.5, currency: 'USD' })).toBe('US$ 1.500,50');
  });

  it('uses 4 fraction digits for values smaller than 1', () => {
    expect(formatCost({ base: 0.1234, tax: 0, total: 0.1234, currency: 'BRL' })).toBe('R$ 0,1234');
    expect(formatCost({ base: 0.005, tax: 0, total: 0.005, currency: 'USD' })).toBe('US$ 0,005');
  });
});
