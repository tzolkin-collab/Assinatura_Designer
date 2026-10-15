import { describe, expect, it } from 'vitest';
import { fontSubstitutionNotice, officialFontsFor } from '../lib/designerBrain/fontNotice.js';

describe('fontSubstitutionNotice', () => {
  it('avisa qual fonte oficial faltou e qual foi usada no lugar', () => {
    const t = fontSubstitutionNotice({ official: ['Queens', 'Aeonik'], used: ['Playfair Display', 'Inter'], installed: [] });
    expect(t).toContain('Queens, Aeonik');
    expect(t).toContain('Playfair Display, Inter');
  });
  it('não conta a própria fonte oficial como substituta', () => {
    const t = fontSubstitutionNotice({ official: ['Queens'], used: ['queens', 'Inter'], installed: [] });
    expect(t).toContain('usa Inter no lugar');
  });
  it('some quando a fonte oficial está instalada', () => {
    expect(fontSubstitutionNotice({ official: ['Queens'], used: ['Queens'], installed: ['Queens'] })).toBeNull();
  });
  it('só menciona as que faltam', () => {
    const t = fontSubstitutionNotice({ official: ['Queens', 'Aeonik'], used: ['Inter'], installed: ['Aeonik'] })!;
    expect(t).toContain('(Queens)');
    expect(t).not.toContain('Aeonik');
  });
  it('projeto sem fonte oficial não gera aviso', () => {
    expect(fontSubstitutionNotice({ official: [], used: ['Inter'] })).toBeNull();
  });
  it('a Amanda tem Queens e Aeonik cadastradas', () => {
    expect(officialFontsFor('amanda-coelho')).toEqual(['Queens', 'Aeonik']);
    expect(officialFontsFor('outra')).toEqual([]);
  });

  it('com ficha salva, a ficha manda: só as fontes que não são Google Fonts', () => {
    const ficha = {
      typography: [
        { family: 'Queens', source: 'reference' as const },
        { family: 'Inter', source: 'google' as const },
        { family: 'Aeonik', source: 'custom' as const },
      ],
    };
    expect(officialFontsFor('amanda-coelho', ficha)).toEqual(['Queens', 'Aeonik']);
    expect(officialFontsFor('amanda-coelho', {})).toEqual([]); // ficha existe e não declara fonte oficial: o seed não volta
  });
});
