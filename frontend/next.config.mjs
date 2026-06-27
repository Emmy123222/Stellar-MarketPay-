
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
].join('; ');

import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  swSrc: "public/sw.src.js",
  sw: "sw.js",
  disable: process.env.NODE_ENV === "development",
});


/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  assetPrefix: process.env.NEXT_PUBLIC_CDN_URL || '',
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es", "fr", "pt"],
  },
  images: {
    loader: 'custom',
    path: process.env.IMAGE_CDN_URL || '',
    formats: ['image/webp', 'image/avif'],
    remotePatterns: [
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: 'cloudflare-ipfs.com' },
      { protocol: 'https', hostname: 'nftstorage.link' },
      { protocol: 'https', hostname: 'w3s.link' },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
  webpack: (config) => {

  webpack: (config, { isServer }) => {

    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    
    // Bundle analyzer configuration
    if (process.env.ANALYZE === 'true') {
      const { BundleAnalyzerPlugin } = require('@next/bundle-analyzer')({
        openAnalyzer: false,
      });
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          reportFilename: isServer ? '../analyze/server.html' : '../analyze/client.html',
          generateStatsFile: true,
          statsFilename: isServer ? '../analyze/server-stats.json' : '../analyze/client-stats.json',
        })
      );
    }
    
    return config;
  },
  env: {
    SKIP_API_CALLS: process.env.SKIP_API_CALLS || "false",
  },
  // HTTP/2 Server Push headers for critical assets
  async headers() {
    return [
      // Preload critical assets
      {
        source: '/:path*',
        headers: [
          {
            key: 'Link',
            value: '</_next/static/css/app/layout.css>; rel=preload; as=style, </_next/static/chunks/webpack.js>; rel=preload; as=script, </_next/static/chunks/framework.js>; rel=preload; as=script',
          },
        ],
      },
      // Cache static assets with long TTL
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Cache profile images with shorter TTL
      {
        source: '/profile/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
  // Optimize bundle splitting
  swcMinify: true,
  // Enable compression
  compress: true,
};
export default withPWA(nextConfig);
