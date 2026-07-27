import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Rotas públicas: qualquer pathname que COMECE com um destes prefixos não
// exige cookie de autenticação. Inclui TODAS as rotas sem autenticação do build:
//   /login, /register, /registro/teamate, /onboarding, /convite/:token,
//   /apresentacao/:slug (apresentação pública), /icon.svg
const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/registro',
  '/onboarding',
  '/convite',
  '/apresentacao',
  '/icon.svg',
];

// Palavras reservadas de primeiro segmento que NÃO são slugs de marca.
// Quando alguém acessa /extras/qualquer-coisa, o middleware normaliza para /extras,
// impedindo que "extras" seja tratado como slug de marca com sub-rota inválida.
// ATENÇÃO: não incluir aqui rotas que têm sub-rotas reais (ex: /configuracoes/perfil,
// /extras/docs/:slug) — elas precisam passar intactas.
const RESERVED_SINGLE_PAGE_ROUTES = new Set([
  'galeria',
  'login',
  'onboarding',
  'projetos',
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Bypass para assets estáticos do Next.js, API interna e favicon
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.json' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 2. Bypass para rotas públicas (sem autenticação)
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 3. Normalização: rotas reservadas de página única não têm sub-rotas válidas.
  //    /galeria/qualquer-coisa → /galeria
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 1 && RESERVED_SINGLE_PAGE_ROUTES.has(segments[0] ?? '')) {
    const normalized = request.nextUrl.clone();
    normalized.pathname = `/${segments[0]}`;
    normalized.search = '';
    return NextResponse.redirect(normalized);
  }

  // 4. Autenticação: todas as demais rotas exigem cookie auth_token
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
