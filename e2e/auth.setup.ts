import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Auth setup project: garante um usuário e2e persistente e salva o
 * storageState (cookie) que o projeto chromium reusa. Login-or-register pela
 * origem do web (:3000) para que o cookie valha para o app. O usuário persiste
 * no DB de dev entre runs, então normalmente só faz login (ilimitado em 200);
 * register (limite 3/h) só dispara na primeira vez.
 */
export const E2E_USER = {
  email: "e2e_canvas_gate@test.local",
  password: "E2ePass12345!",
  name: "E2E Canvas Gate",
};

const STATE_PATH = path.resolve("e2e/.auth/state.json");

setup("authenticate", async ({ request }) => {
  let login = await request.post("/api/auth/login", {
    data: { email: E2E_USER.email, password: E2E_USER.password },
  });

  if (login.status() !== 200) {
    // Usuário ainda não existe (ou senha mudou): cria via register e re-loga.
    const reg = await request.post("/api/auth/register", {
      data: { email: E2E_USER.email, password: E2E_USER.password, name: E2E_USER.name },
    });
    expect(
      [200, 201, 409].includes(reg.status()),
      `register status inesperado: ${reg.status()} ${await reg.text()}`,
    ).toBeTruthy();

    login = await request.post("/api/auth/login", {
      data: { email: E2E_USER.email, password: E2E_USER.password },
    });
  }

  expect(login.status(), `login falhou: ${login.status()} ${await login.text()}`).toBe(200);

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await request.storageState({ path: STATE_PATH });
});
