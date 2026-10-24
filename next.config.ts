import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  experimental: {
    // Activity attachments may be up to 50 MB; the proxy buffers request bodies
    // before route handlers see them. Backup dumps are uploaded in 8 MB chunks.
    proxyClientMaxBodySize: "64mb",
  },
};
export default config;
