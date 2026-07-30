import { describe, it, expect } from 'vitest';
import { extractJsonObject, tryParseJson } from '../lib/jsonHelper';

describe('jsonHelper', () => {
  describe('tryParseJson', () => {
    it('returns parsed object for valid JSON', () => {
      expect(tryParseJson('{"foo": "bar"}')).toEqual({ foo: 'bar' });
      expect(tryParseJson('[1, 2, 3]')).toEqual([1, 2, 3]);
      expect(tryParseJson('"string"')).toEqual('string');
      expect(tryParseJson('123')).toEqual(123);
      expect(tryParseJson('true')).toEqual(true);
      expect(tryParseJson('null')).toEqual(null);
    });

    it('returns undefined for empty string', () => {
      expect(tryParseJson('')).toBeUndefined();
    });

    it('returns undefined for whitespace strings', () => {
      expect(tryParseJson('   ')).toBeUndefined();
      expect(tryParseJson('\n\t')).toBeUndefined();
    });

    it('returns undefined for invalid JSON', () => {
      expect(tryParseJson('{')).toBeUndefined();
      expect(tryParseJson('foo: bar')).toBeUndefined();
      expect(tryParseJson("{'singleQuotes': true}")).toBeUndefined();
      expect(tryParseJson('undefined')).toBeUndefined();
      expect(tryParseJson('NaN')).toBeUndefined();
    });

    // We skip nullish tests for `raw: string` typing in typescript,
    // unless we bypass typescript, which might be helpful if this is used in JS context or AI output
    it('returns undefined for nullish/non-string inputs (type coercion)', () => {
      expect(tryParseJson(null as any)).toBeUndefined();
      expect(tryParseJson(undefined as any)).toBeUndefined();
    });
  });

  describe('extractJsonObject', () => {
    it('extracts direct JSON', () => {
      expect(extractJsonObject('{"foo": "bar"}')).toEqual({ foo: 'bar' });
      expect(extractJsonObject(' \n {"foo": "bar"} \n ')).toEqual({ foo: 'bar' });
    });

    it('extracts JSON from markdown fences', () => {
      expect(extractJsonObject('Here is the json:\n```json\n{"foo": "bar"}\n```\n')).toEqual({ foo: 'bar' });
      expect(extractJsonObject('```\n{"foo": "bar"}\n```')).toEqual({ foo: 'bar' });
    });

    it('extracts JSON from plain text finding braces', () => {
      expect(extractJsonObject('Some AI text before {"foo": "bar"} and some after')).toEqual({ foo: 'bar' });
      expect(extractJsonObject('{"foo": "bar"} some text')).toEqual({ foo: 'bar' });
    });

    it('throws error when no valid JSON is found', () => {
      expect(() => extractJsonObject('just some plain text')).toThrow('AI response did not contain valid JSON');
      expect(() => extractJsonObject('')).toThrow('AI response did not contain valid JSON');
      expect(() => extractJsonObject('```json\n { invalid \n```')).toThrow('AI response did not contain valid JSON');
    });
  });
});
