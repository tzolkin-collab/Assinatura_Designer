import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// /convite/:token é público de propósito: quem aceita um convite ainda não tem conta.
// A prova de acesso é o token do link. Repare que ele NÃO entra em
// RESERVED_TOP_LEVEL_ROUTES — aquela lista redireciona /x/y para /x, o que jogaria o
// token fora. Pelo mesmo motivo, /registro/teamate e /configuracoes/* também ficam de
// fora: são sub-rotas globais REAIS (não [marca]/algo) que não podem ser cortadas.
//
// Bug real encontrado 2026-07-20 (mesma classe do fix no Sidebar): esta lista
// existe para impedir que uma palavra reservada (rota global) seja tratada como se
// FOSSE o slug de uma marca — ex. sem 'projetos' aqui, /projetos/fabrica batia direto
// no [marca]/fabrica com marca="projetos" (inexistente) em vez de normalizar para
// /projetos. 'projetos' estava faltando; sincronizado com as rotas globais reais de
// src/app/ que não têm sub-rota própria.
const PUBLIC_ROUTES = ['/login', '/convite'];
const RESERVED_TOP_LEVEL_ROUTES = new Set(['equipe', 'extras', 'galeria', 'login', 'onboarding', 'projetos']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length > 1 && RESERVED_TOP_LEVEL_ROUTES.has(segments[0] ?? '')) {
    const normalized = request.nextUrl.clone();
    normalized.pathname = `/${segments[0]}`;
    normalized.search = '';
    return NextResponse.redirect(normalized);
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow static assets and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.json' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Check for auth token (cookie-based for middleware, localStorage fallback on client)
  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
