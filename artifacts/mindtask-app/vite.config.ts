import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const monorepoRoot = path.resolve(import.meta.dirname, "..", "..");

// Load .env from the monorepo root so we can share secrets/ports across artifacts.
const env = loadEnv(process.env.NODE_ENV ?? "development", monorepoRoot, "");
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const rawPort = process.env.WEB_PORT ?? process.env.PORT;

if (!rawPort) {
  throw new Error(
    "WEB_PORT (or PORT) environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid WEB_PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  envDir: monorepoRoot,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      react: path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-dev-runtime"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "@tiptap/react",
      "@tiptap/core",
      "@tiptap/starter-kit",
      "use-sync-external-store/shim/index.js",
      "use-sync-external-store/shim/with-selector.js",
    ],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: process.env.VITE_API_BASE_URL
      ? {
          "/api": {
            target: process.env.VITE_API_BASE_URL,
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
