import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * better-sqlite3 is a native module -- it must stay a real Node require in
   * the server bundle rather than being traced and bundled by Turbopack.
   */
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
