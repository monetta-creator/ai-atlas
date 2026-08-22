import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root (a stray parent-dir lockfile otherwise confuses inference).
  turbopack: {
    root: path.resolve("."),
  },
  // The PDF routes read the embedded font binaries at runtime (Font.register with
  // fs paths); the tracer can't see through that, so include them explicitly.
  outputFileTracingIncludes: {
    "/reports/[id]/pdf": ["./lib/pdf/fonts/*.ttf"],
    "/hypothesis-report/[id]/pdf": ["./lib/pdf/fonts/*.ttf"],
  },
};

export default nextConfig;
