import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'sharp'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
