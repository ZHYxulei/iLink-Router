/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // iLink bot singleton needs to persist across re-renders
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Server-only Node deps that should NOT be bundled by webpack —
  // Next.js will require() them at runtime instead.
  serverExternalPackages: [
    '@wechatbot/wechatbot',
    '@prisma/client',
    'qrcode',
  ],
};

module.exports = nextConfig;
