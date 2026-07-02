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
};

export default nextConfig;
