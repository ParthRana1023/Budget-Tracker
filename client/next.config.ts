import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // Service worker version (PwaRegister registers /sw.js?v=<id>): a new deploy installs a
    // new worker and cache. Vercel sets the commit SHA; local builds use the build time.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now()),
  },
};

export default nextConfig;
