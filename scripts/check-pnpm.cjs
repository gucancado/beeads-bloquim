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

const ua = process.env.npm_config_user_agent ?? "";
if (!ua.startsWith("pnpm/")) {
  process.stderr.write(
    "This monorepo requires pnpm. Install with `npm install -g pnpm@9` and re-run.\n",
  );
  process.exit(1);
}
