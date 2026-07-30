import { describe, it, expect } from 'vitest';
import { formatMonth } from './aiUsageFormat';

describe('formatMonth', () => {
  it('formats a valid month correctly', () => {
    expect(formatMonth('2026-07')).toBe('Julho de 2026');
    expect(formatMonth('2023-01')).toBe('Janeiro de 2023');
  });

  it('returns the original string if the input is malformed (no dash)', () => {
    expect(formatMonth('invalid')).toBe('invalid');
  });

  it('returns the original string if the input is missing the month', () => {
    expect(formatMonth('2026')).toBe('2026');
  });

  it('returns the original string if the input is missing the year', () => {
    expect(formatMonth('-07')).toBe('-07');
  });

  it('returns the original string if the input is empty', () => {
    expect(formatMonth('')).toBe('');
  });
});
