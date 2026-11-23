import {
  BarChart3,
  Bot,
  BookOpen,
  Brain,
  Factory,
  GalleryHorizontalEnd,
  Images,
  LayoutDashboard,
  LayoutGrid,
  MonitorPlay,
  Palette,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

// FONTE ÚNICA da navegação. O menu lateral e a tela de configurações da marca liam listas
// diferentes, e o mesmo item tinha três nomes ("Agente IA" no menu, "Agente e Memória" na tela;
// "Mídia e Fontes" no menu, "Biblioteca de Mídia" na tela). Aqui cada item tem UM nome, UM
// ícone e UM endereço. Cada ícone aparece uma vez só: antes Globe, Eye e Settings se repetiam
// em itens diferentes.

export interface NavDef {
  label: string;
  icon: LucideIcon;
  href: string;
}

/**
 * Páginas que não dependem de marca. "Projetos da equipe" saiu em 22/11/2026: repetia o filtro
 * "Descobrir" da própria galeria (/projetos agora redireciona para lá).
 */
export const GLOBAL_NAV: NavDef[] = [
  { label: 'Minhas marcas', icon: LayoutGrid, href: '/galeria' },
  { label: 'Configurações gerais', icon: Settings, href: '/configuracoes' },
];

export const EXTRAS_NAV: NavDef[] = [
  { label: 'Documentação', icon: BookOpen, href: '/extras/docs' },
];

/** Páginas de uma marca. */
export function brandNav(marca: string): NavDef[] {
  return [
    // Visão geral e Cérebro da IA entraram depois da reorganização do menu (#76/#77) e foram
    // religados aqui, na fonte única da navegação.
    { label: 'Visão geral', icon: LayoutDashboard, href: `/${marca}` },
    { label: 'Cérebro da IA', icon: Brain, href: `/${marca}/cerebro` },
    { label: 'Galeria', icon: GalleryHorizontalEnd, href: `/${marca}/galeria` },
    { label: 'Fábrica', icon: Factory, href: `/${marca}/fabrica` },
    // "Editor" saiu do menu em 22/11/2026: não era uma tela, só reabria a última apresentação.
    // O endereço continua funcionando; o editor se abre pela Galeria e pelo /editor da Fábrica.
    { label: 'Publicadas', icon: MonitorPlay, href: `/${marca}/apresentacoes` },
  ];
}

export interface SettingsSection {
  /** Último trecho do endereço: /{marca}/configuracoes/{key}. */
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Seções de configuração de uma marca: usadas pelo menu lateral E pela tela de configurações.
 * "Equipe e permissões" saiu em 22/11/2026: todo usuário da equipe interna vira membro de toda
 * marca automaticamente (backend/src/lib/internalTeam.ts), então remover ou convidar pela tela
 * não fazia o que prometia. O endereço antigo redireciona para as configurações.
 */
export const BRAND_SETTINGS: SettingsSection[] = [
  {
    key: 'agent',
    label: 'Instruções do agente',
    description: 'O que o chat da Fábrica segue ao conversar sobre a marca. Na geração valem as regras do Cérebro.',
    icon: Bot,
  },
  {
    key: 'branding',
    label: 'Branding',
    description: 'Identidade visual: cores, tipografia (Google Fonts) e diretrizes da marca.',
    icon: Palette,
  },
  {
    key: 'midia',
    label: 'Biblioteca de mídia',
    description: 'Imagens, logos e outros arquivos que a IA pode usar nas artes desta marca.',
    icon: Images,
  },
  {
    key: 'billing',
    label: 'Gastos de IA',
    description: 'Consumo e custo estimado por modelo, mês a mês.',
    icon: BarChart3,
  },
];

export const BRAND_SETTINGS_GROUP = { label: 'Configurações', icon: SlidersHorizontal } as const;

/** O item está ativo? Igualdade exata para a raiz de uma seção, prefixo para páginas internas. */
export function isActivePath(pathname: string, href: string, exact = false): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}
