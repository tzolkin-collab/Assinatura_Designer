import { describe, it, expect } from 'vitest';
import { extractJsonObject, tryParseJson } from '../lib/jsonHelper';

describe('tryParseJson', () => {
  it('devolve o valor parseado para JSON valido', () => {
    expect(tryParseJson('{"foo": "bar"}')).toEqual({ foo: 'bar' });
    expect(tryParseJson('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(tryParseJson('"string"')).toEqual('string');
    expect(tryParseJson('123')).toEqual(123);
    expect(tryParseJson('true')).toEqual(true);
    expect(tryParseJson('null')).toEqual(null);
  });

  it('devolve undefined para string vazia ou so espacos', () => {
    expect(tryParseJson('')).toBeUndefined();
    expect(tryParseJson('   ')).toBeUndefined();
    expect(tryParseJson('\n\t')).toBeUndefined();
  });

  it('devolve undefined para JSON invalido', () => {
    expect(tryParseJson('{')).toBeUndefined();
    expect(tryParseJson('foo: bar')).toBeUndefined();
    expect(tryParseJson("{'aspasSimples': true}")).toBeUndefined();
    expect(tryParseJson('undefined')).toBeUndefined();
    expect(tryParseJson('NaN')).toBeUndefined();
  });
});

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

  // Casos de borda do fallback por chaves: indexOf('{') ate lastIndexOf('}').
  it('lanca erro quando ha { sem } correspondente', () => {
    const input = 'Text with { but no closing brace';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });

  it('lanca erro quando ha } sem { correspondente', () => {
    const input = 'Text with } but no opening brace';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });

  it('lanca erro quando } aparece antes de {', () => {
    const input = 'Text with } first and then { later';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });

  // O fallback pega do primeiro { ao ultimo }, entao dois objetos separados
  // por texto viram uma fatia invalida — nao o primeiro objeto.
  it('lanca erro quando dois objetos JSON sao separados por texto', () => {
    const input = 'Primeiro {"a": 1} e depois {"b": 2}';
    expect(() => extractJsonObject(input)).toThrow('AI response did not contain valid JSON');
  });
});
