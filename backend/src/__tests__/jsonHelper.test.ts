import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../lib/jsonHelper';

describe('extractJsonObject', () => {
  it('should parse a pure JSON object', () => {
    const input = '{"key": "value"}';
    const result = extractJsonObject(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse a pure JSON array', () => {
    const input = '[{"key": "value"}]';
    const result = extractJsonObject(input);
    expect(result).toEqual([{ key: 'value' }]);
  });

  it('should parse JSON enclosed in markdown fences', () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = extractJsonObject(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON enclosed in generic markdown fences', () => {
    const input = '```\n{"key": "value"}\n```';
    const result = extractJsonObject(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON embedded within conversational text', () => {
    const input = 'Here is the JSON you requested:\n{"key": "value"}\nLet me know if you need anything else.';
    const result = extractJsonObject(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('should handle text before and after json fences', () => {
    const input = 'Here is your data:\n```json\n{"key": "value"}\n```\nHope it helps!';
    const result = extractJsonObject(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('should throw an error when no valid JSON is found', () => {
    const input = 'This is just a regular text without any JSON.';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error when the JSON is malformed', () => {
    const input = 'Here is the JSON: {"key": "value"';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });
});
