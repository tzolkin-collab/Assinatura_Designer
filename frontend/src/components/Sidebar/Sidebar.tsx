'use client';
import Image from 'next/image';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Factory,
  FileText,
  Settings,
  Palette,
  Eye,
  Bot,
  PenTool,
  ChevronDown,
  Menu,
  X,
  LogOut,
  Users,
  Globe,
  BarChart3,
  Image as ImageIcon,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import NotificationBell from '../Notification/NotificationBell';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  children?: NavItem[];
}

const mainNav: NavItem[] = [
  { label: 'Minhas Marcas', href: '/galeria', icon: <LayoutGrid size={18} /> },
  { label: 'Projetos da Equipe', href: '/projetos', icon: <Globe size={18} /> },
  { label: 'Configurações Gerais', href: '/configuracoes', icon: <Settings size={18} /> },
];

const extrasNav: NavItem[] = [
  { label: 'Documentação', href: '/extras/docs', icon: <FileText size={18} /> },
];

function getBrandNav(marca: string): NavItem[] {
  return [
    { label: 'Galeria', href: `/${marca}/galeria`, icon: <Eye size={18} /> },
    { label: 'Fábrica', href: `/${marca}/fabrica`, icon: <Factory size={18} /> },

    {
      label: 'Configurações',
      href: `/${marca}/configuracoes`,
      icon: <Settings size={18} />,
      children: [
        { label: 'Visão Geral', href: `/${marca}/configuracoes`, icon: <Settings size={16} /> },
        { label: 'Agente IA', href: `/${marca}/configuracoes/agent`, icon: <Bot size={16} /> },
        { label: 'Branding', href: `/${marca}/configuracoes/branding`, icon: <Palette size={16} /> },
        { label: 'Referências', href: `/${marca}/configuracoes/referencias`, icon: <Eye size={16} /> },
        { label: 'Equipe', href: `/${marca}/configuracoes/equipe`, icon: <Users size={16} /> },
        { label: 'Mídia e Fontes', href: `/${marca}/configuracoes/midia`, icon: <ImageIcon size={16} /> },
        { label: 'Gastos de IA', href: `/${marca}/configuracoes/billing`, icon: <BarChart3 size={16} /> },
      ],
    },
  ];
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(pathname.startsWith(item.href));
  const isActive = pathname === item.href;
  const hasChildren = item.children && item.children.length > 0;

  if (hasChildren) {
    return (
      <div className={styles.navGroup}>
        <button
          className={[styles.navLink, open ? styles.navLinkOpen : ''].join(' ')}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
          <ChevronDown
            size={14}
            className={[styles.chevron, open ? styles.chevronOpen : ''].join(' ')}
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

  return (
    <Link
      href={item.href}
      className={[styles.navLink, isActive ? styles.navLinkActive : ''].join(' ')}
    >
      <span className={styles.navIcon}>{item.icon}</span>
      <span className={styles.navLabel}>{item.label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Detect if we're inside a brand context
  const segments = pathname.split('/').filter(Boolean);
  const knownRoots = ['galeria', 'fabrica', 'editor', 'extras', 'login', 'equipe', 'onboarding', 'configuracoes'];
  const marca = segments.length > 0 && !knownRoots.includes(segments[0]) ? segments[0] : null;

  return (
    <>
      {/* Mobile toggle */}
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
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
        <nav className={styles.nav}>
          <div className={styles.navSection}>
            <span className={styles.navSectionLabel}>Principal</span>
            {mainNav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>

          {/* Brand context navigation */}
          {marca && (
            <div className={styles.navSection}>
              <span className={styles.navSectionLabel}>{decodeURIComponent(marca)}</span>
              {getBrandNav(marca).map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          )}

          <div className={styles.navSection}>
            <span className={styles.navSectionLabel}>Extras</span>
            {extrasNav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </nav>

        {/* Bottom section */}
        <div className={styles.bottom}>
          <div className={styles.divider} />
          <div className={styles.user}>
            <div className={styles.avatar}>U</div>
            <div className={styles.userInfo}>
              <span className={styles.userName}>Usuário</span>
              <span className={styles.userRole}>Designer</span>
            </div>
            <NotificationBell />
            <button
              className={styles.logoutBtn}
              title="Sair"
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
