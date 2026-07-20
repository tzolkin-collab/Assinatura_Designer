'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
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
  const router = useRouter();

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    setLoading(true);
    api
      .get<{ myRole?: BrandRole }>(`/brands/${slug}`)
      .then((brand) => {
        if (!cancelled) setRole(brand.myRole);
      })
      .catch((err) => {
        if (cancelled) return;
        setRole(undefined);
        // 403 (sem acesso) e 404 (marca não existe) são definitivos — nenhuma
        // página de marca funciona sem isto, e antes o usuário ficava preso
        // numa tela quebrada (ex.: Fábrica presa em "Reconectando..." pra
        // sempre). Erro de rede/servidor (status 0 ou 5xx) NÃO redireciona:
        // pode ser transitório, e chutar o usuário pra fora por um blip de
        // conexão seria pior do que a tela ficar carregando mais um pouco.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          router.replace('/galeria?erro=marca-invalida');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, router]);

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
