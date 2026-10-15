import type { BrandProfileData } from '../../brandProfile.js';

// A memória da Amanda Coelho (Cérebro de IA §11.10, Gabriela, 04/10/2026) como FICHA estruturada.
//
// Mesmo texto de `amandaCoelho.ts`, só dividido nas seções da ficha: nenhuma palavra foi
// reescrita ou acrescentada. Mudança de texto vem da Gabriela e é feita aqui, sem paráfrase.
//
// O que a memória original NÃO traz fica de fora, e a ficha mostra como pendente em vez de
// inventar: tom e direção de escrita, arquivos de logo, manual visual em imagem e regras de collab.
// Logo, manual e arquivos de fonte vêm da biblioteca do projeto (precisam ser enviados).
//
// Tipografia como `reference`: Queens e Aeonik são comerciais e não estão instaladas, então o
// sistema avisa e usa uma substituta, como já faz hoje.

export const AMANDA_COELHO_PROFILE: BrandProfileData = {
  essence:
    'A direção visual deve comunicar uma mulher forte, sofisticada, segura, magnética, experiente, estratégica, intensa e contemporânea. Combinação central: sofisticação + força + irreverência controlada + inteligência + feminilidade adulta. A marca pode flertar com moda, editorial, cultura, arte e luxo contemporâneo, preservando autoridade e clareza.',
  palette: [
    { hex: '#410C1C', name: 'vinho profundo', role: 'principal, fundos dramáticos, luxo e contraste' },
    { hex: '#8E242E', name: 'vermelho vinho', role: 'energia, destaques e grafismos' },
    { hex: '#D8E9F3', name: 'azul-gelo', role: 'contraste contemporâneo e respiro' },
    { hex: '#FCF9EB', name: 'off-white/creme', role: 'fundo claro principal' },
  ],
  typography: [
    {
      family: 'Queens',
      role: 'títulos, manchetes, frases de impacto, capas, palavras-chave e assinatura editorial. Queens = personalidade.',
      source: 'reference',
    },
    {
      family: 'Aeonik',
      role: 'textos explicativos, subtítulos, listas, dados e informações funcionais. Aeonik = clareza.',
      source: 'reference',
    },
  ],
  artDirection:
    'Editorial e sofisticada. Usar respiro, assimetria intencional, grids limpos, contraste de escala, tipografia grande, fotografia ocupando áreas relevantes e enquadramentos não óbvios. Não centralizar tudo. Não criar aparência de template de Canva ou PowerPoint corporativo.',
  realPhoto:
    'Usar somente fotografias reais fornecidas da Amanda. Nunca gerar uma pessoa fictícia ou uma versão sintética dela. Preservar rosto e características individuais. Preferir movimento, palco, bastidores, interação, gestos e retrato editorial. P&B é permitido e valorizado. Se a foto necessária não existir, reservar área para inserção posterior.',
  graphicElements:
    'Poucos elementos. Linhas finas, recortes, blocos de cor, grids editoriais, monograma/letras ampliadas e sobreposição sutil quando fizer sentido.',
  neverDo: [
    'Não introduzir outras cores dominantes.',
    'Estética de coach',
    'corporativo frio',
    'feminino romântico/delicado',
    'beauty infantil',
    'stock photo',
    'escritório genérico',
    'gradientes decorativos',
    'ícones 3D',
    'blobs',
    'neon',
    'glitter',
    'flor',
    'dourado clichê',
    'cards em excesso',
    'sombra pesada',
    'caixa arredondada genérica',
    'texto sobre rosto',
    'logo inventado ou deformado',
  ],
  approvalCriterion:
    'A peça deve parecer pertencer a uma empresária que construiu empresas, entende de negócios, tem repertório e ocupa espaço com naturalidade. Deve ter presença editorial premium e linguagem autoral, sem perder clareza.',
};
