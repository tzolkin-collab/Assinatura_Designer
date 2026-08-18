import { describe, it, expect } from 'vitest';
import { lerGuidelines, mesclarGuidelines } from '../lib/brandGuidelines';

const MARCADOR = '### Atualização do Brandbook:';

describe('lerGuidelines', () => {
  it('lê o formato da página de Branding', () => {
    const { estrutura, textoSolto } = lerGuidelines(
      JSON.stringify({ name: 'Assinatura', history: 'Consultoria de marca', website: 'https://x.com', instagram: '@x', style: 'Sóbrio', restrictions: 'Sem emoji' }),
    );
    expect(estrutura.name).toBe('Assinatura');
    expect(estrutura.history).toBe('Consultoria de marca');
    expect(textoSolto).toBe('');
  });

  it('lê texto puro como texto solto, sem inventar campo', () => {
    const { estrutura, textoSolto } = lerGuidelines('A marca é sóbria e direta.');
    expect(estrutura.name).toBe('');
    expect(textoSolto).toBe('A marca é sóbria e direta.');
  });

  it('descarta placeholder do formulário em vez de tratá-lo como conteúdo', () => {
    const { estrutura } = lerGuidelines(
      JSON.stringify({ name: 'Nome da Marca', history: 'Resumo sobre o que a marca faz e sua essência', website: 'https://', instagram: '@', style: 'Minimalista e limpo', restrictions: 'Sem emojis exagerados' }),
    );
    expect(estrutura).toEqual({ name: '', history: '', website: '', instagram: '', style: '', restrictions: '' });
  });

  // A forma exata que quebrou em produção: JSON seguido de texto concatenado.
  it('separa JSON de texto concatenado pela ingestão antiga', () => {
    const bruto = JSON.stringify({ name: 'Assinatura', history: 'História original', website: '', instagram: '', style: '', restrictions: '' })
      + `\n\n${MARCADOR}\nTom de voz direto e estratégico.`;
    const { estrutura, textoSolto } = lerGuidelines(bruto);
    expect(estrutura.name).toBe('Assinatura');
    expect(estrutura.history).toBe('História original');
    expect(textoSolto).toBe('Tom de voz direto e estratégico.');
  });

  // O estado em que as 4 marcas ficaram: conteúdo real enterrado dentro de `history`.
  it('desaninha guidelines gravado dentro do próprio history', () => {
    const interno = JSON.stringify({ name: 'Assinatura', history: 'A identidade visual real', website: 'https://a.com', instagram: '@a', style: 'Luxo', restrictions: '' });
    const externo = JSON.stringify({ name: 'Nome da Marca', history: interno, website: 'https://', instagram: '@', style: 'Minimalista e limpo', restrictions: 'Sem emojis exagerados' });
    const { estrutura } = lerGuidelines(externo);
    expect(estrutura.name).toBe('Assinatura');
    expect(estrutura.history).toBe('A identidade visual real');
    expect(estrutura.website).toBe('https://a.com');
  });

  it('aguenta vazio e nulo', () => {
    expect(lerGuidelines('').estrutura.name).toBe('');
    expect(lerGuidelines(null).textoSolto).toBe('');
    expect(lerGuidelines(undefined).textoSolto).toBe('');
  });
});

describe('mesclarGuidelines', () => {
  it('devolve JSON válido — nunca JSON com texto colado no fim', () => {
    const r = mesclarGuidelines(
      JSON.stringify({ name: 'Assinatura', history: 'Original', website: '', instagram: '', style: '', restrictions: '' }),
      'Texto novo do brandbook',
    );
    expect(() => JSON.parse(r)).not.toThrow();
    const p = JSON.parse(r);
    expect(p.name).toBe('Assinatura');
    expect(p.history).toContain('Original');
    expect(p.history).toContain('Texto novo do brandbook');
  });

  it('preserva os campos que o humano preencheu', () => {
    const p = JSON.parse(mesclarGuidelines(
      JSON.stringify({ name: 'Assinatura', history: '', website: 'https://a.com', instagram: '@a', style: 'Luxo', restrictions: 'Sem emoji' }),
      'Novo',
    ));
    expect(p.website).toBe('https://a.com');
    expect(p.style).toBe('Luxo');
    expect(p.restrictions).toBe('Sem emoji');
  });

  it('não duplica ao reingerir o mesmo brandbook', () => {
    const uma = mesclarGuidelines(JSON.stringify({ name: 'X', history: '', website: '', instagram: '', style: '', restrictions: '' }), 'Bloco A');
    const duas = mesclarGuidelines(uma, 'Bloco A');
    expect(JSON.parse(duas).history).toBe('Bloco A');
  });

  it('recupera a marca já corrompida em produção', () => {
    const interno = JSON.stringify({ name: 'Assinatura', history: 'Identidade real', website: '', instagram: '', style: '', restrictions: '' });
    const corrompido = JSON.stringify({ name: 'Nome da Marca', history: interno, website: 'https://', instagram: '@', style: 'Minimalista e limpo', restrictions: 'Sem emojis exagerados' });
    const p = JSON.parse(mesclarGuidelines(corrompido, 'Bloco novo'));
    expect(p.name).toBe('Assinatura');
    expect(p.history).toContain('Identidade real');
    expect(p.history).toContain('Bloco novo');
  });

  it('parte de texto puro sem perder o texto', () => {
    const p = JSON.parse(mesclarGuidelines('Só um texto antigo', 'Novo bloco'));
    expect(p.history).toContain('Só um texto antigo');
    expect(p.history).toContain('Novo bloco');
  });
});

describe('normalizarParaFormulario — nome da marca', () => {
  it('usa Brand.name quando o nome nunca foi gravado', async () => {
    const { normalizarParaFormulario } = await import('../lib/brandGuidelines');
    const r = normalizarParaFormulario('Texto solto qualquer', 'Assinatura');
    expect(r.name).toBe('Assinatura');
    expect(r.history).toBe('Texto solto qualquer');
  });

  it('não sobrescreve nome já digitado pelo humano', async () => {
    const { normalizarParaFormulario } = await import('../lib/brandGuidelines');
    const bruto = JSON.stringify({ name: 'Nome Escolhido', history: 'x', website: '', instagram: '', style: '', restrictions: '' });
    expect(normalizarParaFormulario(bruto, 'Outro Nome').name).toBe('Nome Escolhido');
  });

  it('ignora o placeholder e cai no Brand.name', async () => {
    const { normalizarParaFormulario } = await import('../lib/brandGuidelines');
    const bruto = JSON.stringify({ name: 'Nome da Marca', history: 'x', website: '', instagram: '', style: '', restrictions: '' });
    expect(normalizarParaFormulario(bruto, 'Farmacia Indiana').name).toBe('Farmacia Indiana');
  });
});
