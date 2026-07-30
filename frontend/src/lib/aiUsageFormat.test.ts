import { describe, it, expect } from 'vitest';
import { formatTokens, formatTokensFull } from './aiUsageFormat';

describe('formatTokens', () => {
  it('formats values less than 1,000 without abbreviation', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(900)).toBe('900');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats values between 1,000 and 999,999 with "mil"', () => {
    expect(formatTokens(1000)).toBe('1 mil');
    expect(formatTokens(1200)).toBe('1,2 mil');
    expect(formatTokens(12300)).toBe('12,3 mil');
    expect(formatTokens(12345)).toBe('12,3 mil');
    expect(formatTokens(999900)).toBe('999,9 mil');
  });

  it('formats values of 1,000,000 or greater with "M"', () => {
    expect(formatTokens(1000000)).toBe('1 M');
    expect(formatTokens(1230000)).toBe('1,23 M');
    expect(formatTokens(1234567)).toBe('1,23 M');
    expect(formatTokens(1239999)).toBe('1,24 M'); // Tests maximumFractionDigits rounding
    expect(formatTokens(10000000)).toBe('10 M');
  });
});

describe('formatTokensFull', () => {
  it('formats values with thousands separators', () => {
    expect(formatTokensFull(0)).toBe('0');
    expect(formatTokensFull(900)).toBe('900');
    expect(formatTokensFull(1234)).toBe('1.234');
    expect(formatTokensFull(1234567)).toBe('1.234.567');
  });
});
