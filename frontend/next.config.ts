import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-041004270f10418bb8c5f4abc56dde7f.r2.dev',
        pathname: '/**',
      },
    ],
  },
  // A antiga tela "Gestão de Tenants" foi removida; o endereço cai nas Configurações gerais.
  async redirects() {
    return [
      {
        source: '/configuracoes/tenants',
        destination: '/configuracoes',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
