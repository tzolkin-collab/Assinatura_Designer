import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../lib/jsonHelper.js';

describe('extractJsonObject', () => {
  it('should parse valid direct JSON', () => {
    const raw = '{"key": "value"}';
    const result = extractJsonObject(raw);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse valid fenced JSON with markdown code blocks', () => {
    const raw = '```json\n{"key": "value"}\n```';
    const result = extractJsonObject(raw);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse valid fenced JSON without language tag', () => {
    const raw = '```\n{"key": "value"}\n```';
    const result = extractJsonObject(raw);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON using fallback substring method (embedded in text)', () => {
    const raw = 'Here is the JSON response: {"key": "value"} Hope it helps!';
    const result = extractJsonObject(raw);
    expect(result).toEqual({ key: 'value' });
  });

  it('should throw an error if no braces are found', () => {
    const raw = 'Just some text, no JSON here.';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error if braces are unmatched (only {)', () => {
    const raw = 'Text with { but no closing brace';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error if braces are unmatched (only })', () => {
    const raw = 'Text with } but no opening brace';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error if } appears before {', () => {
    const raw = 'Text with } first and then { later';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error if braces are matched but content is invalid JSON', () => {
    const raw = 'Text with { invalid json } inside';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });

  it('should throw an error if multiple JSON objects span across non-json text', () => {
    // indexOf('{') gets the first {, lastIndexOf('}') gets the last }
    // The substring is { "a": 1 } text { "b": 2 } which is invalid JSON
    const raw = 'Some text { "a": 1 } other text { "b": 2 } more text';
    expect(() => extractJsonObject(raw)).toThrow('AI response did not contain valid JSON');
  });
});
