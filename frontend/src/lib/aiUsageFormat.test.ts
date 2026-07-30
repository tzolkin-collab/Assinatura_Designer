import { describe, it, expect } from 'vitest';
import { prettyModel } from './aiUsageFormat';

describe('prettyModel', () => {
  it('substitui o prefixo "gemini-" por "Gemini "', () => {
    expect(prettyModel('gemini-1.5-pro')).toBe('Gemini 1.5 pro');
    expect(prettyModel('gemini-1.0-ultra')).toBe('Gemini 1.0 ultra');
  });

  it('remove o sufixo "-preview"', () => {
    expect(prettyModel('gemini-1.5-flash-preview')).toBe('Gemini 1.5 flash');
    expect(prettyModel('model-name-preview')).toBe('model name');
  });

  it('substitui todos os hifens restantes por espacos', () => {
    expect(prettyModel('gpt-4-turbo')).toBe('gpt 4 turbo');
    expect(prettyModel('claude-3-opus-20240229')).toBe('claude 3 opus 20240229');
  });

  it('funciona corretamente com strings simples sem hifens', () => {
    expect(prettyModel('llama3')).toBe('llama3');
    expect(prettyModel('mistral')).toBe('mistral');
  });

  it('nao substitui "gemini-" se nao estiver no inicio', () => {
    expect(prettyModel('my-gemini-model')).toBe('my gemini model');
  });

  it('nao remove "-preview" se nao estiver no final', () => {
    expect(prettyModel('model-preview-version')).toBe('model preview version');
  });
});
