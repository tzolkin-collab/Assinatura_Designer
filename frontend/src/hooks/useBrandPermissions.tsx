'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  can as canDo,
  isReadOnly as roleIsReadOnly,
  permissionHint,
  type BrandAction,
  type BrandRole,
} from '@/lib/permissions';

interface BrandPermissions {
  role: BrandRole | undefined;
  loading: boolean;
  /** Pode executar a ação nesta marca? Enquanto carrega, retorna false. */
  can: (action: BrandAction) => boolean;
  /** Atalho: o usuário só consegue ver (VIEWER). */
  readOnly: boolean;
  /** Mensagem para tooltip do controle desabilitado. */
  hint: string;
}

const BrandPermissionsContext = createContext<BrandPermissions | null>(null);

/**
 * Carrega o papel do usuário na marca uma única vez, no layout, e distribui para as
 * páginas. O backend já devolve `myRole` em GET /brands/:slug — o dado sempre esteve
 * lá, a interface é que o ignorava e oferecia botões que voltavam 403.
 */
export function BrandPermissionsProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const [role, setRole] = useState<BrandRole | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    setLoading(true);
    api
      .get<{ myRole?: BrandRole }>(`/brands/${slug}`)
      .then((brand) => {
        if (!cancelled) setRole(brand.myRole);
      })
      .catch(() => {
        // 403/404 aqui significa "não é membro": sem papel, tudo fica bloqueado.
        if (!cancelled) setRole(undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const value = useMemo<BrandPermissions>(
    () => ({
      role,
      loading,
      // Enquanto carrega, nada é permitido: melhor um botão que aparece habilitado
      // um instante depois do que um que some na cara do usuário.
      can: (action) => (loading ? false : canDo(role, action)),
      readOnly: roleIsReadOnly(role),
      hint: permissionHint(role),
    }),
    [role, loading],
  );

  return (
    <BrandPermissionsContext.Provider value={value}>{children}</BrandPermissionsContext.Provider>
  );
}

export function useBrandPermissions(): BrandPermissions {
  const ctx = useContext(BrandPermissionsContext);
  if (!ctx) {
    throw new Error('useBrandPermissions precisa estar dentro de <BrandPermissionsProvider>');
  }
  return ctx;
}
