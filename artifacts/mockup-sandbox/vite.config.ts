import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const isReplit = process.env.REPL_ID !== undefined;
const replitPlugins: PluginOption[] = [];
if (isReplit) {
  try {
    const runtimeErrorModal = await import("@replit/vite-plugin-runtime-error-modal");
    replitPlugins.push(runtimeErrorModal.default());
  } catch {
    // optional dep not installed; ignore silently outside Replit
  }
  try {
    const cartographer = await import("@replit/vite-plugin-cartographer");
    replitPlugins.push(
      cartographer.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
    );
  } catch {
    // optional dep not installed; ignore silently outside Replit
  }
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
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
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
