import {
  BarChart3,
  Bot,
  BookOpen,
  Eye,
  Factory,
  FolderKanban,
  GalleryHorizontalEnd,
  Images,
  LayoutDashboard,
  LayoutGrid,
  MonitorPlay,
  Palette,
  PenTool,
  Settings,
  SlidersHorizontal,
  Users,
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

/** Páginas que não dependem de marca. */
export const GLOBAL_NAV: NavDef[] = [
  { label: 'Minhas marcas', icon: LayoutGrid, href: '/galeria' },
  { label: 'Projetos da equipe', icon: FolderKanban, href: '/projetos' },
  { label: 'Configurações gerais', icon: Settings, href: '/configuracoes' },
];

export const EXTRAS_NAV: NavDef[] = [
  { label: 'Documentação', icon: BookOpen, href: '/extras/docs' },
];

/** Páginas de uma marca. */
export function brandNav(marca: string): NavDef[] {
  return [
    { label: 'Galeria', icon: GalleryHorizontalEnd, href: `/${marca}/galeria` },
    { label: 'Fábrica', icon: Factory, href: `/${marca}/fabrica` },
    { label: 'Editor', icon: PenTool, href: `/${marca}/editor` },
    { label: 'Apresentações publicadas', icon: MonitorPlay, href: `/${marca}/apresentacoes` },
  ];
}

export interface SettingsSection {
  /** Último trecho do endereço: /{marca}/configuracoes/{key}. */
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** Seções de configuração de uma marca: usadas pelo menu lateral E pela tela de configurações. */
export const BRAND_SETTINGS: SettingsSection[] = [
  {
    key: 'agent',
    label: 'Agente e memória',
    description: 'Instruções do agente de IA e as regras e preferências que ele aprendeu sobre a marca.',
    icon: Bot,
  },
  {
    key: 'branding',
    label: 'Branding',
    description: 'Identidade visual: cores, tipografia (Google Fonts) e diretrizes da marca.',
    icon: Palette,
  },
  {
    key: 'referencias',
    label: 'Referências',
    description: 'Marcas de referência analisadas pelo agente.',
    icon: Eye,
  },
  {
    key: 'equipe',
    label: 'Equipe e permissões',
    description: 'Convide clientes e designers e defina quem pode editar ou apenas visualizar.',
    icon: Users,
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

export const BRAND_SETTINGS_OVERVIEW = { label: 'Visão geral', icon: LayoutDashboard } as const;
export const BRAND_SETTINGS_GROUP = { label: 'Configurações', icon: SlidersHorizontal } as const;

/** O item está ativo? Igualdade exata para a raiz de uma seção, prefixo para páginas internas. */
export function isActivePath(pathname: string, href: string, exact = false): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}
