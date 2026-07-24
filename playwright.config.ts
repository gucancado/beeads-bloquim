import { defineConfig, devices } from "@playwright/test";

/**
 * E2E gate for the action-plan canvas (substitui o checklist manual 0.2 do
 * Mapa Estratégico). Sobe api-server + mindtask-app de dev (que auto-carregam
 * o .env da raiz) e dirige um chromium real — ReactFlow precisa de um browser
 * de verdade (drag, viewport, getBoundingClientRect), não roda em jsdom.
 *
 * Roda contra o DB de dev (mesmo do `.env`); os testes limpam o que criam.
 */
const WEB_PORT = process.env.WEB_PORT ?? "3000";
const API_PORT = process.env.API_PORT ?? "5000";

export default defineConfig({
  testDir: "./e2e",
  // Remote dev DB (São Paulo) + cold vite dep-optimize na 1ª navegação tornam
  // tudo lento; folga generosa.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // e2e de interação contra DB remoto tem ruído de timing; 1 retry evita
  // falha espúria sem mascarar regressão consistente.
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev",
      url: `http://localhost:${API_PORT}/api/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @workspace/mindtask-app run dev",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
