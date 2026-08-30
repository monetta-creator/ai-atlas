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
    "/reports/sheet/[id]/pdf": ["./lib/pdf/fonts/*.ttf"],
    "/reports/[id]/pdf": ["./lib/pdf/fonts/*.ttf"],
    "/thesis-report/[id]/pdf": ["./lib/pdf/fonts/*.ttf"],
    "/costs/deck/pdf": ["./lib/pdf/fonts/*.ttf"],
    "/ingestion/deck/pdf": ["./lib/pdf/fonts/*.ttf"],
  },
};

export default nextConfig;
