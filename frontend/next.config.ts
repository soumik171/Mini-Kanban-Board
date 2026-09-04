import type { NextConfig } from "next";

// In development the Next dev server proxies API calls to the Express
// backend so the app is fully same-origin (cookies "just work"). Point
// BACKEND_URL elsewhere to hit a deployed API instead.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
