import type { Metadata, Viewport } from 'next';
import { Newsreader, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell/AppShell';

const sourceSans = Source_Sans_3({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source-sans',
  display: 'swap',
});

// Serifa dos títulos (base "marfim editorial", 23/11/2026). Fonte variável com eixo de tamanho
// óptico: o mesmo arquivo desenha o título de 40px e o de 22px com o contraste certo para cada um.
const newsreader = Newsreader({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Designer - Assinatura Marca Própria',
  description: 'Plataforma interna de criação e gestão de branding para redes sociais.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/app-icon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icons/app-icon.svg',
    apple: '/icons/app-icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#faf9f5',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className={`${sourceSans.variable} ${newsreader.variable}`}>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
