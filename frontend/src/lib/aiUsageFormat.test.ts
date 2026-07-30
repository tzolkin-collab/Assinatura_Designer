import { describe, it, expect } from 'vitest';
import { formatTokensFull } from './aiUsageFormat';

describe('formatTokensFull', () => {
  it('formats small numbers without separators', () => {
    expect(formatTokensFull(0)).toBe('0');
    expect(formatTokensFull(999)).toBe('999');
  });

  it('formats thousands with a dot separator', () => {
    expect(formatTokensFull(1000)).toBe('1.000');
  });

  it('formats millions with multiple dot separators', () => {
    expect(formatTokensFull(1234567)).toBe('1.234.567');
  });
});
