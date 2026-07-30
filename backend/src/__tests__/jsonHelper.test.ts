import { describe, it, expect } from 'vitest';
import { extractJsonObject, tryParseJson } from '../lib/jsonHelper';

describe('tryParseJson', () => {
  it('should return undefined if invalid json is provided and JSON.parse throws', () => {
    expect(tryParseJson('invalid json')).toBeUndefined();
  });

  it('should return parsed object if valid json is provided', () => {
    expect(tryParseJson('{"key": "value"}')).toEqual({key: 'value'});
  });
});

describe('extractJsonObject', () => {
  it('should throw Error if invalid json is provided', () => {
    expect(() => extractJsonObject('invalid json')).toThrow('AI response did not contain valid JSON');
  });

  it('should parse valid json object', () => {
    expect(extractJsonObject('{"key": "value"}')).toEqual({key: 'value'});
  });

  it('should parse valid json array', () => {
    expect(extractJsonObject('["value"]')).toEqual(['value']);
  });

  it('should parse valid json with fenced format', () => {
    expect(extractJsonObject('```json\n{"key": "value"}\n```')).toEqual({key: 'value'});
  });

  it('should extract valid json object within a string', () => {
    expect(extractJsonObject('text before {"key": "value"} text after')).toEqual({key: 'value'});
  });
});
