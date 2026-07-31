import { describe, it, expect } from 'vitest';
import {
  formatTokens,
  formatTokensFull,
  formatMoney,
  formatCost,
  formatMonth,
  prettyModel
} from './aiUsageFormat';

describe('aiUsageFormat', () => {
  describe('formatTokens', () => {
    it('formats millions correctly', () => {
      expect(formatTokens(1_234_567)).toBe('1,23 M');
      expect(formatTokens(2_000_000)).toBe('2 M');
    });

    it('formats thousands correctly', () => {
      expect(formatTokens(12_300)).toBe('12,3 mil');
      expect(formatTokens(1_000)).toBe('1 mil');
    });

    it('formats values under 1000 correctly', () => {
      expect(formatTokens(900)).toBe('900');
      expect(formatTokens(0)).toBe('0');
    });
  });

  describe('formatTokensFull', () => {
    it('formats numbers fully with pt-BR locale', () => {
      expect(formatTokensFull(1_234_567)).toBe('1.234.567');
      expect(formatTokensFull(12_300)).toBe('12.300');
      expect(formatTokensFull(900)).toBe('900');
    });
  });

  describe('formatMoney', () => {
    it('formats BRL correctly', () => {
      expect(formatMoney(12.34, 'BRL')).toBe('R$ 12,34');
      expect(formatMoney(1000, 'BRL')).toBe('R$ 1.000,00');
    });

    it('formats USD correctly', () => {
      expect(formatMoney(12.34, 'USD')).toBe('US$ 12,34');
      expect(formatMoney(1000, 'USD')).toBe('US$ 1.000,00');
    });

    it('uses up to 4 decimal places for values < 1', () => {
      expect(formatMoney(0.1234, 'USD')).toBe('US$ 0,1234');
      expect(formatMoney(0.12, 'USD')).toBe('US$ 0,12');
      expect(formatMoney(0.12345, 'USD')).toBe('US$ 0,1235'); // 5 rounds up in pt-BR normally but testing precision
    });
  });

  describe('formatCost', () => {
    it('returns "—" for 0 or negative cost', () => {
      expect(formatCost({ currency: 'USD', base: 0, tax: 0, total: 0 })).toBe('—');
      expect(formatCost({ currency: 'USD', base: -1, tax: 0, total: -1 })).toBe('—');
    });

    it('returns formatted money for positive cost', () => {
      expect(formatCost({ currency: 'USD', base: 10, tax: 2, total: 12.34 })).toBe('US$ 12,34');
      expect(formatCost({ currency: 'BRL', base: 10, tax: 0, total: 12.34 })).toBe('R$ 12,34');
    });
  });

  describe('formatMonth', () => {
    it('formats YYYY-MM into full Portuguese month string', () => {
      expect(formatMonth('2026-07')).toBe('Julho de 2026');
      expect(formatMonth('2024-01')).toBe('Janeiro de 2024');
    });

    it('returns the original string if format is invalid', () => {
      expect(formatMonth('invalid')).toBe('invalid');
      expect(formatMonth('')).toBe('');
    });
  });

  describe('prettyModel', () => {
    it('formats gemini models correctly', () => {
      expect(prettyModel('gemini-1.5-pro')).toBe('Gemini 1.5 pro');
      expect(prettyModel('gemini-1.5-flash-preview')).toBe('Gemini 1.5 flash');
      expect(prettyModel('gemini-ultra')).toBe('Gemini ultra');
    });

    it('formats other models correctly by replacing hyphens', () => {
      expect(prettyModel('other-model-name')).toBe('other model name');
    });
  });
});
