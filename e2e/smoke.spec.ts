import { test, expect } from "@playwright/test";

test("authenticated app loads (boot + auth plumbing)", async ({ page }) => {
  await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
  // Authenticated → must NOT be bounced to the login page.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).toHaveURL(/\/workspaces/);
});
