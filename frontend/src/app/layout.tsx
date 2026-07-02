import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell/AppShell';

export const metadata: Metadata = {
  title: 'Designer - Assinatura Marca Própria',
  description: 'Plataforma interna de criação e gestão de branding para redes sociais.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <style id="dynamic-fonts"></style>
      </head>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
