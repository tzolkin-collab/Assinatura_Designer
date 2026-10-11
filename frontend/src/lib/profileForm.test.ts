import { describe, it, expect } from 'vitest';
import { emptyForm, formErrors, formToProfile, profileToForm, splitItems, splitLines, type BrandProfile } from './profileForm';

const ficha: BrandProfile = {
  essence: 'Mulher forte e sofisticada.',
  palette: [{ hex: '#410C1C', name: 'Vinho', role: 'principal' }, { hex: '#FCF9EB' }],
  typography: [
    { family: 'Queens', role: 'títulos', source: 'reference', referenceImageUrl: 'https://cdn.exemplo.com/queens.png' },
    { family: 'Aeonik', source: 'google' },
  ],
  logo: { files: [{ url: 'https://cdn.exemplo.com/logo.png', label: 'wordmark' }], rules: 'Nunca redesenhar.' },
  visualManual: { imageUrl: 'https://cdn.exemplo.com/manual.png', notes: 'Editorial.' },
  neverDo: ['Degradês coloridos', 'Texto sobre rosto'],
  brandCodes: [{ category: 'Tom', items: ['Sofisticado', 'Seguro'] }],
  mayVary: ['Layout'],
  mustKeep: ['Logo'],
  collabRules: 'Manter um código forte.',
  legacyNotes: 'texto antigo',
};

describe('splitLines e splitItems', () => {
  it('uma linha por item, sem vazias nem espaços', () => {
    expect(splitLines('  a \n\n b\r\n c  ')).toEqual(['a', 'b', 'c']);
    expect(splitLines('   ')).toEqual([]);
  });

  it('itens por vírgula ou quebra de linha', () => {
    expect(splitItems('Respiro, Elegância\nClareza ,, ')).toEqual(['Respiro', 'Elegância', 'Clareza']);
  });
});

describe('profileToForm e formToProfile', () => {
  it('ida e volta não perde nem inventa nada', () => {
    expect(formToProfile(profileToForm(ficha))).toEqual(ficha);
  });

  it('formulário vazio gera ficha vazia: campo em branco não vira valor', () => {
    expect(formToProfile(emptyForm())).toEqual({});
  });

  it('descarta linhas em branco e aponta só o que foi preenchido', () => {
    const f = emptyForm();
    f.essence = '   ';
    f.palette = [{ hex: '', name: 'Sem cor', role: '' }, { hex: ' #8E242E ', name: '', role: '' }];
    f.neverDo = 'Primeira\n\n  \nSegunda';
    f.logoFiles = [{ url: '', label: 'vazio' }];
    expect(formToProfile(f)).toEqual({ palette: [{ hex: '#8E242E' }], neverDo: ['Primeira', 'Segunda'] });
  });

  it('o arquivo da fonte só vale para o tipo a que pertence', () => {
    const f = emptyForm();
    f.typography = [
      { family: 'A', role: '', source: 'google', fileUrl: 'https://x.com/a.otf', referenceImageUrl: 'https://x.com/a.png' },
      { family: 'B', role: '', source: 'custom', fileUrl: 'https://x.com/b.otf', referenceImageUrl: 'https://x.com/b.png' },
      { family: 'C', role: '', source: 'reference', fileUrl: 'https://x.com/c.otf', referenceImageUrl: 'https://x.com/c.png' },
    ];
    expect(formToProfile(f).typography).toEqual([
      { family: 'A', source: 'google' },
      { family: 'B', source: 'custom', fileUrl: 'https://x.com/b.otf' },
      { family: 'C', source: 'reference', referenceImageUrl: 'https://x.com/c.png' },
    ]);
  });

  it('manual visual leva só imagem, só notas ou os dois', () => {
    const so = (imageUrl: string, notes: string) => {
      const f = emptyForm();
      f.manualImageUrl = imageUrl;
      f.manualNotes = notes;
      return formToProfile(f).visualManual;
    };
    expect(so('https://x.com/m.png', '')).toEqual({ imageUrl: 'https://x.com/m.png' });
    expect(so('', 'notas')).toEqual({ notes: 'notas' });
    expect(so('', '')).toBeUndefined();
  });

  it('código sem categoria é descartado; itens viram lista', () => {
    const f = emptyForm();
    f.brandCodes = [{ category: 'Tom', items: 'Sofisticado, Seguro' }, { category: '  ', items: 'solto' }];
    expect(formToProfile(f).brandCodes).toEqual([{ category: 'Tom', items: ['Sofisticado', 'Seguro'] }]);
  });
});

describe('formErrors', () => {
  it('formulário válido não tem erro', () => {
    expect(formErrors(profileToForm(ficha))).toEqual([]);
  });

  it('aponta hex fora do formato, com o valor', () => {
    const f = emptyForm();
    f.palette = [{ hex: 'vinho', name: '', role: '' }, { hex: '#FFF', name: '', role: '' }, { hex: '#410C1C', name: '', role: '' }];
    expect(formErrors(f)).toEqual(['Cor inválida na paleta (vinho, #FFF): use o formato #RRGGBB.']);
  });

  it('aponta fonte sem família e código sem categoria', () => {
    const f = emptyForm();
    f.typography = [{ family: '', role: 'títulos', source: '', fileUrl: '', referenceImageUrl: '' }];
    f.brandCodes = [{ category: '', items: 'Respiro' }];
    expect(formErrors(f)).toEqual(['Tem fonte sem nome da família.', 'Tem código sem categoria (ex.: Tom, Personalidade).']);
  });

  it('linha totalmente vazia não é erro', () => {
    const f = emptyForm();
    f.typography = [{ family: '', role: '', source: '', fileUrl: '', referenceImageUrl: '' }];
    f.palette = [{ hex: '', name: '', role: '' }];
    expect(formErrors(f)).toEqual([]);
  });
});
