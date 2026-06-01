#!/usr/bin/env node
// Cross-platform replacement for the previous `sh -c` preinstall hook.
// Refuses to run install with anything other than pnpm.

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

for (const stale of ["package-lock.json", "yarn.lock"]) {
  const p = path.join(repoRoot, stale);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

// Only refuse install when a NON-pnpm package manager is positively detected.
// (Don't hard-require a specific pnpm prefix/version — corepack/CI contexts may
// not surface `npm_config_user_agent` as `pnpm/...`, and the repo runs on pnpm 11.)
const ua = process.env.npm_config_user_agent ?? "";
if (ua.startsWith("npm/") || ua.startsWith("yarn/") || ua.startsWith("bun/")) {
  process.stderr.write(
    "This monorepo requires pnpm. Install with `corepack enable && pnpm install`.\n",
  );
  process.exit(1);
}
