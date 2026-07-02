'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar/Sidebar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
}

const NO_SIDEBAR_ROUTES = ['/login', '/onboarding'];

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const hideSidebar = NO_SIDEBAR_ROUTES.includes(pathname);

  if (hideSidebar) {
    return <>{children}</>;
  }

  const isFullBleed = /\/editor\/.+|\/fabrica/.test(pathname);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={isFullBleed ? styles.mainFull : styles.main}>
        {children}
      </main>
    </div>
  );
}
