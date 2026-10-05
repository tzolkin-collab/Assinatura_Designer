'use client';
import Image from 'next/image';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X, LogOut, type LucideIcon } from 'lucide-react';
import styles from './Sidebar.module.css';
import NotificationBell from '../Notification/NotificationBell';
import { useAuth } from '@/lib/hooks';
import { api } from '@/lib/api';
import {
  BRAND_SETTINGS,
  BRAND_SETTINGS_GROUP,
  BRAND_SETTINGS_OVERVIEW,
  EXTRAS_NAV,
  GLOBAL_NAV,
  brandNav,
  isActivePath,
} from '@/lib/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
}

/** Configurações da marca: um grupo que abre, com a visão geral e cada seção. */
function brandSettingsGroup(marca: string): NavItem {
  const base = `/${marca}/configuracoes`;
  return {
    label: BRAND_SETTINGS_GROUP.label,
    icon: BRAND_SETTINGS_GROUP.icon,
    href: base,
    children: [
      { label: BRAND_SETTINGS_OVERVIEW.label, icon: BRAND_SETTINGS_OVERVIEW.icon, href: base },
      ...BRAND_SETTINGS.map((section) => ({
        label: section.label,
        icon: section.icon,
        href: `${base}/${section.key}`,
      })),
    ],
  };
}

// O título da seção da marca mostrava o slug ("assinatura"). O nome vem da própria marca;
// guardado em memória para não buscar de novo a cada navegação.
const brandNameCache = new Map<string, string>();

function useBrandName(slug: string | null): string | null {
  const [buscados, setBuscados] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!slug || brandNameCache.has(slug)) return;
    let vivo = true;
    api.get<{ name?: string }>(`/brands/${slug}`)
      .then((b) => {
        if (!b?.name) return;
        brandNameCache.set(slug, b.name);
        if (vivo) setBuscados((prev) => ({ ...prev, [slug]: b.name! }));
      })
      .catch(() => { /* sem nome, o título cai no slug como antes */ });
    return () => { vivo = false; };
  }, [slug]);
  return slug ? (brandNameCache.get(slug) ?? buscados[slug] ?? null) : null;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const hasChildren = !!item.children && item.children.length > 0;
  // O grupo fica "ativo" quando a página aberta é uma das filhas, e não só aberto.
  const childActive = hasChildren && item.children!.some((c) => isActivePath(pathname, c.href, c.href === item.href));
  const [open, setOpen] = useState(pathname.startsWith(item.href));
  const Icon = item.icon;

  if (hasChildren) {
    return (
      <div className={styles.navGroup}>
        <button
          type="button"
          className={[styles.navLink, open ? styles.navLinkOpen : '', childActive ? styles.navLinkActive : ''].join(' ')}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className={styles.navIcon}><Icon size={18} /></span>
          <span className={styles.navLabel}>{item.label}</span>
          <ChevronDown
            size={14}
            className={[styles.chevron, open ? styles.chevronOpen : ''].join(' ')}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div className={styles.navChildren}>
            {item.children!.map((child) => (
              <NavLink key={child.href} item={child} pathname={pathname} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // A "Visão geral" tem o mesmo endereço do grupo: só é ativa na igualdade exata.
  const isActive = isActivePath(pathname, item.href, item.href.endsWith('/configuracoes'));
  return (
    <Link
      href={item.href}
      className={[styles.navLink, isActive ? styles.navLinkActive : ''].join(' ')}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.navIcon}><Icon size={item.href.split('/').length > 3 ? 16 : 18} /></span>
      <span className={styles.navLabel}>{item.label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  // Detect if we're inside a brand context ([marca]/...) vs. numa rota GLOBAL
  // (sem marca). Bug real encontrado 2026-07-20: esta lista estava incompleta
  // ('projetos' faltava) — em /projetos, o Sidebar tratava "projetos" como se
  // FOSSE o slug de uma marca e montava uma seção "Galeria/Fábrica" fantasma
  // apontando para /projetos/galeria e /projetos/fabrica (rotas inexistentes).
  // Clicar nesse "Fábrica" fantasma não voltava para a sessão real — parecia
  // "perder o chat" ao navegar pela sidebar. Lista sincronizada com TODOS os
  // segmentos de 1º nível fora de [marca] em src/app/.
  const segments = pathname.split('/').filter(Boolean);
  const knownRoots = [
    'galeria', 'projetos', 'configuracoes', 'convite', 'registro', 'extras', 'login', 'onboarding',
    // Sub-rotas de marca cujo nome poderia colidir com o slug de uma marca homônima.
    'fabrica', 'editor', 'equipe', 'apresentacoes',
  ];
  const urlMarca = segments.length > 0 && !knownRoots.includes(segments[0]) ? segments[0] : null;

  // A seção da marca NUNCA pode sumir da sidebar ao navegar para uma página
  // GLOBAL (Minhas Marcas, Projetos da Equipe, Configurações Gerais, etc.) —
  // pedido explícito do usuário (2026-07-20): o projeto/chat aberto deve
  // continuar visível/acessível até ele de fato entrar em OUTRA marca ou
  // começar outra apresentação. Persistido em localStorage (sobrevive a
  // reload e nova aba) para "lembrar" a última marca visitada quando a URL
  // atual não tem marca nenhuma.
  const [lastBrand, setLastBrand] = useState<string | null>(null);
  useEffect(() => {
    if (urlMarca) {
      localStorage.setItem('sidebar_last_brand', urlMarca);
      setLastBrand(urlMarca);
    } else {
      setLastBrand(localStorage.getItem('sidebar_last_brand'));
    }
  }, [urlMarca]);

  const marca = urlMarca ?? lastBrand;
  const brandName = useBrandName(marca);

  return (
    <>
      {/* Mobile toggle */}
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div className={styles.overlay} onClick={() => setMobileOpen(false)} />
      )}

      <aside className={[styles.sidebar, mobileOpen ? styles.sidebarOpen : ''].join(' ')}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoMark}><Image src="/logo.svg" alt="Assinatura" width={24} height={24} priority /></div>
          <div className={styles.logoText}>
            <span className={styles.logoTitle}>Assinatura</span>
            <span className={styles.logoSub}>Design Studio</span>
          </div>
        </div>

        <div className={styles.divider} />

        {/* Main navigation */}
        <nav className={styles.nav} aria-label="Navegação principal">
          <div className={styles.navSection}>
            <span className={styles.navSectionLabel}>Geral</span>
            {GLOBAL_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>

          {/* Brand context navigation */}
          {marca && (
            <div className={styles.navSection}>
              <span className={styles.navSectionLabel}>{brandName ?? decodeURIComponent(marca)}</span>
              {[...brandNav(marca), brandSettingsGroup(marca)].map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          )}

          <div className={styles.navSection}>
            <span className={styles.navSectionLabel}>Extras</span>
            {EXTRAS_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </nav>

        {/* Bottom section */}
        <div className={styles.bottom}>
          <div className={styles.divider} />
          <div className={styles.user}>
            <div className={styles.avatar}>{user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}</div>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{user?.name || 'Carregando...'}</span>
              <span className={styles.userRole}>{user?.role === 'ADMIN' ? 'Administrador' : 'Designer'}</span>
            </div>
            <NotificationBell />
            <button
              className={styles.logoutBtn}
              title="Sair"
              aria-label="Sair da conta"
              onClick={() => {
                localStorage.removeItem('auth_token');
                document.cookie = 'auth_token=; path=/; max-age=0';
                window.location.href = '/login';
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
