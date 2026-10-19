import { describe, it, expect } from 'vitest';
import {
  AMANDA_COELHO_MEMORY,
  DesignerBrainSetupError,
  buildPipelineBrainContext,
  designerBrainBrands,
  isDesignerBrainEnabled,
  resolveProjectMemory,
} from '../lib/designerBrain';

describe('interruptor por marca (DESIGNER_BRAIN_BRANDS)', () => {
  it('vazio ou ausente = desligado em todas as marcas', () => {
    expect(isDesignerBrainEnabled('assinatura', undefined)).toBe(false);
    expect(isDesignerBrainEnabled('assinatura', '')).toBe(false);
    expect(designerBrainBrands('')).toEqual([]);
  });

  it('liga só as marcas listadas', () => {
    expect(isDesignerBrainEnabled('amanda-coelho', 'amanda-coelho')).toBe(true);
    expect(isDesignerBrainEnabled('assinatura', 'amanda-coelho')).toBe(false);
  });

  it('aceita lista com espaços, maiúsculas e vírgulas sobrando', () => {
    const env = ' Amanda-Coelho , rubrica,, ';
    expect(designerBrainBrands(env)).toEqual(['amanda-coelho', 'rubrica']);
    expect(isDesignerBrainEnabled('RUBRICA', env)).toBe(true);
  });

  it('não casa por prefixo', () => {
    expect(isDesignerBrainEnabled('amanda', 'amanda-coelho')).toBe(false);
  });
});

describe('memória do projeto', () => {
  it('o cadastro da marca vence o seed do repositório', () => {
    expect(resolveProjectMemory('amanda-coelho', '  memória editada no sistema  ')).toBe('memória editada no sistema');
  });

  it('sem cadastro, usa o seed da marca', () => {
    expect(resolveProjectMemory('amanda-coelho', '')).toBe(AMANDA_COELHO_MEMORY);
    expect(resolveProjectMemory('Amanda-Coelho', null)).toBe(AMANDA_COELHO_MEMORY);
  });

  it('ficha salva vence o cadastro antigo e o seed; ficha vazia cai para eles', () => {
    const ficha = { essence: 'ESSENCIA-FICHA', palette: [{ hex: '#111111' }] };
    const texto = resolveProjectMemory('amanda-coelho', 'texto antigo', ficha, 'Amanda');
    expect(texto).toContain('PROJETO: Amanda');
    expect(texto).toContain('ESSENCIA-FICHA');
    expect(texto).not.toContain('texto antigo');
    expect(resolveProjectMemory('amanda-coelho', 'texto antigo', {}, 'Amanda')).toBe('texto antigo');
    expect(resolveProjectMemory('amanda-coelho', '', {}, 'Amanda')).toBe(AMANDA_COELHO_MEMORY);
  });

  it('sem cadastro e sem seed, não inventa', () => {
    expect(resolveProjectMemory('marca-nova', '')).toBeNull();
  });
});

describe('contexto do pipeline com o cérebro ligado', () => {
  const amanda = { slug: 'amanda-coelho', name: 'Amanda Coelho', agentPrompt: '' };

  it('marca ligada sem nenhuma memória falha de forma visível', () => {
    expect(() =>
      buildPipelineBrainContext({
        brand: { slug: 'marca-nova', name: 'Nova', agentPrompt: '' },
        format: 'presentation',
      }),
    ).toThrow(DesignerBrainSetupError);
  });

  it('apresentação: global + memória + modo + regra de foto + revisão', () => {
    const { brandContext } = buildPipelineBrainContext({ brand: amanda, format: 'presentation', pageCount: 8 });
    expect(brandContext).toContain('Você é a inteligência de direção de arte do sistema Designer');
    expect(brandContext).toContain('#410C1C');
    expect(brandContext).toContain('MODO: APRESENTAÇÃO');
    expect(brandContext).toContain('REGRA DE FOTOGRAFIA PARA ESTA PEÇA');
    expect(brandContext).toContain('REVISÃO OBRIGATÓRIA');
  });

  it('carrossel usa o modo de imagem avulsa, não o de apresentação', () => {
    const { brandContext } = buildPipelineBrainContext({ brand: amanda, format: 'carousel', aspectRatio: '4:5' });
    expect(brandContext).toContain('MODO: IMAGEM AVULSA');
    expect(brandContext).not.toContain('MODO: APRESENTAÇÃO');
  });

  it('não repete o briefing nem os ativos, que o pipeline já entrega por conta própria', () => {
    const { brandContext } = buildPipelineBrainContext({ brand: amanda, format: 'presentation', pageCount: 8 });
    expect(brandContext).not.toContain('ATIVOS REAIS DISPONÍVEIS');
    expect(brandContext).not.toContain('INSTRUÇÃO ESPECÍFICA DA PEÇA');
  });

  it('registra como pendência o que não foi informado, sem inventar', () => {
    const sem = buildPipelineBrainContext({ brand: amanda, format: 'presentation' });
    const com = buildPipelineBrainContext({ brand: amanda, format: 'presentation', pageCount: 8 });
    expect(sem.pending).toContain('Número total de slides');
    expect(com.pending).toEqual([]);
  });

  it('o carrossel assume 1:1 quando não há proporção, e não fica pendente', () => {
    const { pending } = buildPipelineBrainContext({ brand: amanda, format: 'carousel' });
    expect(pending).toEqual([]);
  });

  it('outra marca com memória própria não recebe nada da Amanda (Teste 6)', () => {
    const { brandContext } = buildPipelineBrainContext({
      brand: { slug: 'rubrica', name: 'Rubrica', agentPrompt: 'PROJETO ATIVO: RUBRICA\n#AA0000 vermelho rubrica.' },
      format: 'presentation',
      pageCount: 5,
    });
    expect(brandContext).toContain('#AA0000');
    for (const hex of ['#410C1C', '#8E242E', '#D8E9F3', '#FCF9EB']) expect(brandContext).not.toContain(hex);
    expect(brandContext).not.toContain('Queens');
  });
});

describe('contexto do pipeline com o cérebro global: projeto sem memória não é erro', () => {
  const semMemoria = { slug: 'marca-nova', name: 'Nova', agentPrompt: '' };

  it('com o resumo do cadastro como reserva, usa-o como projeto e registra a memória como pendência (nada inventado)', () => {
    const { brandContext, pending } = buildPipelineBrainContext({
      brand: semMemoria,
      format: 'presentation',
      pageCount: 5,
      fallbackMemory: 'Marca: Nova\nCores: #112233',
    });
    expect(brandContext).toContain('Você é a inteligência de direção de arte do sistema Designer');
    expect(brandContext).toContain('Cores: #112233');
    expect(pending).toEqual(['Memória do projeto-base (ficha do projeto)']);
  });

  it('reserva vazia (só espaços) continua sendo erro de configuração', () => {
    expect(() =>
      buildPipelineBrainContext({ brand: semMemoria, format: 'presentation', fallbackMemory: '   ' }),
    ).toThrow(DesignerBrainSetupError);
  });

  it('a reserva só entra quando NADA resolve: instruções do agente, seed e ficha vencem', () => {
    const agente = buildPipelineBrainContext({
      brand: { ...semMemoria, agentPrompt: 'INSTRUCOES-DO-AGENTE' },
      format: 'presentation',
      pageCount: 5,
      fallbackMemory: 'RESERVA-DO-CADASTRO',
    });
    expect(agente.brandContext).toContain('INSTRUCOES-DO-AGENTE');
    expect(agente.brandContext).not.toContain('RESERVA-DO-CADASTRO');
    expect(agente.pending).toEqual([]);

    const seed = buildPipelineBrainContext({
      brand: { slug: 'amanda-coelho', name: 'Amanda Coelho', agentPrompt: '' },
      format: 'presentation',
      pageCount: 5,
      fallbackMemory: 'RESERVA-DO-CADASTRO',
    });
    expect(seed.brandContext).toContain('#410C1C');
    expect(seed.brandContext).not.toContain('RESERVA-DO-CADASTRO');

    const ficha = buildPipelineBrainContext({
      brand: semMemoria,
      profile: { essence: 'ESSENCIA-FICHA' },
      format: 'presentation',
      pageCount: 5,
      fallbackMemory: 'RESERVA-DO-CADASTRO',
    });
    expect(ficha.brandContext).toContain('ESSENCIA-FICHA');
    expect(ficha.brandContext).not.toContain('RESERVA-DO-CADASTRO');
    expect(ficha.pending).toEqual([]);
  });
});
