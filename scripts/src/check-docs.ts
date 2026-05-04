import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function extractRouteMountPaths(routesIndex: string): string[] {
  const paths: string[] = [];
  for (const match of routesIndex.matchAll(/router\.use\("([^"]+)"/g)) {
    paths.push(match[1]!);
  }
  for (const match of routesIndex.matchAll(/router\.use\((\w+)\)/g)) {
    const varName = match[1]!;
    if (varName === "healthRouter") paths.push("/health");
    else if (varName === "storageRouter") paths.push("/storage");
  }
  return [...new Set(paths)];
}

function normalizeRoutePath(p: string): string {
  return p
    .replace(/:workspaceId/g, ":wId")
    .replace(/:mapId/g, ":mId")
    .replace(/:taskId/g, ":tId")
    .replace(/:cardId/g, ":cId");
}

function routeDocumented(docContent: string, routePath: string): boolean {
  if (docContent.includes(routePath)) return true;

  const normalized = normalizeRoutePath(routePath);
  if (docContent.includes(normalized)) return true;

  const segments = routePath.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1]!;
  const abbreviatedPath = `/api/.../${lastSegment}`;
  if (docContent.includes(abbreviatedPath)) return true;

  const lastTwoSegments = segments.slice(-2).join("/");
  if (docContent.includes(lastTwoSegments)) return true;

  const normalizedLast = normalizeRoutePath(lastTwoSegments);
  if (docContent.includes(normalizedLast)) return true;

  return false;
}

function extractTableNames(schemaFiles: string[]): string[] {
  const tables: string[] = [];
  for (const file of schemaFiles) {
    const content = readFile(file);
    for (const match of content.matchAll(/pgTable\("([^"]+)"/g)) {
      tables.push(match[1]!);
    }
  }
  return tables;
}

function extractSchemaExports(schemaIndex: string): string[] {
  const files: string[] = [];
  for (const match of schemaIndex.matchAll(/export \* from "\.\/([^"]+)"/g)) {
    files.push(`lib/db/src/schema/${match[1]}.ts`);
  }
  return files;
}

function extractRouteFileNames(routesIndex: string): string[] {
  const files: string[] = [];
  for (const match of routesIndex.matchAll(/from "\.\/([^"]+)"/g)) {
    files.push(match[1]!);
  }
  return files;
}

function main() {
  const routesIndex = readFile("artifacts/api-server/src/routes/index.ts");
  const schemaIndex = readFile("lib/db/src/schema/index.ts");

  const routePaths = extractRouteMountPaths(routesIndex);
  const routeFiles = extractRouteFileNames(routesIndex);
  const schemaFiles = extractSchemaExports(schemaIndex);
  const tableNames = extractTableNames(schemaFiles);

  const claudeMd = readFile("CLAUDE.md");
  const replitMd = readFile("replit.md");

  let hasIssues = false;

  console.log("=== Documentation Sync Check ===\n");
  console.log(`Found ${routePaths.length} route mounts in routes/index.ts`);
  console.log(`Found ${routeFiles.length} route files imported`);
  console.log(`Found ${tableNames.length} tables in db/schema\n`);

  for (const [docName, docContent] of [
    ["CLAUDE.md", claudeMd],
    ["replit.md", replitMd],
  ] as const) {
    console.log(`--- ${docName} ---`);

    const missingRoutes = routePaths.filter((r) => !routeDocumented(docContent, r));
    if (missingRoutes.length > 0) {
      hasIssues = true;
      console.log(`  ⚠ Route mount paths not found in docs:`);
      for (const r of missingRoutes) {
        console.log(`    - ${r}`);
      }
    } else {
      console.log(`  ✓ All route mount paths documented`);
    }

    const missingTables = tableNames.filter((t) => !docContent.includes(t));
    if (missingTables.length > 0) {
      hasIssues = true;
      console.log(`  ⚠ Tables not found in docs:`);
      for (const t of missingTables) {
        console.log(`    - ${t}`);
      }
    } else {
      console.log(`  ✓ All tables documented`);
    }

    const missingRouteFiles: string[] = [];
    for (const rf of routeFiles) {
      const fileName = rf.includes("/") ? rf.split("/").pop()! : rf;
      if (!docContent.includes(fileName + ".ts") && !docContent.includes(fileName + " ")) {
        missingRouteFiles.push(rf + ".ts");
      }
    }
    if (missingRouteFiles.length > 0) {
      hasIssues = true;
      console.log(`  ⚠ Route files not mentioned in structure:`);
      for (const f of missingRouteFiles) {
        console.log(`    - ${f}`);
      }
    } else {
      console.log(`  ✓ All route files listed in structure`);
    }

    const schemaModules = schemaFiles.map((f) => f.split("/").pop()!);
    const missingSchemaFiles = schemaModules.filter((sf) => !docContent.includes(sf));
    if (missingSchemaFiles.length > 0) {
      hasIssues = true;
      console.log(`  ⚠ Schema files not mentioned in structure:`);
      for (const f of missingSchemaFiles) {
        console.log(`    - ${f}`);
      }
    } else {
      console.log(`  ✓ All schema files listed in structure`);
    }

    console.log();
  }

  if (hasIssues) {
    console.log("❌ Documentation is out of sync. Please update CLAUDE.md and/or replit.md.");
    process.exit(1);
  } else {
    console.log("✅ Documentation is in sync with code.");
    process.exit(0);
  }
}

main();
