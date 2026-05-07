/**
 * Migração one-shot Replit → Supabase prod + Cloudflare R2 prod.
 *
 * Roda DENTRO do Replit shell (precisa de acesso ao sidecar de Object Storage
 * em 127.0.0.1:1106 e à DATABASE_URL local). Lê dados+arquivos do Replit e
 * empurra pra stack nova via internet (Supabase Postgres + R2 S3-compatible).
 *
 * Uso (dentro do Replit shell):
 *   # 1. Baixe o script:
 *   curl -O https://raw.githubusercontent.com/gucancado/beeads-bloquim/master/scripts/migrate-replit-to-prod.mjs
 *
 *   # 2. Garanta as deps (pg e @google-cloud/storage já estão; pode faltar S3 SDK):
 *   pnpm add -w @aws-sdk/client-s3 || npm install @aws-sdk/client-s3
 *
 *   # 3. Defina as envs do destino. As de origem (DATABASE_URL, PRIVATE_OBJECT_DIR)
 *   #    já estão no shell do Replit.
 *   export PROD_DATABASE_URL='postgresql://postgres.<ref>:<pass>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres'
 *   export PROD_S3_ENDPOINT='https://<ACCOUNT_ID>.r2.cloudflarestorage.com'
 *   export PROD_S3_ACCESS_KEY_ID='<r2 access key>'
 *   export PROD_S3_SECRET_ACCESS_KEY='<r2 secret>'
 *   export PROD_S3_BUCKET_ATTACHMENTS='bloquim-attachments-prod'
 *   export PROD_S3_BUCKET_AVATARS='bloquim-avatars-prod'
 *
 *   # 4. Inventário (lê só, não escreve em lugar nenhum):
 *   node migrate-replit-to-prod.mjs --inventory
 *
 *   # 5. Dry-run (lê dos dois lados, mostra o que faria, mas NÃO escreve):
 *   node migrate-replit-to-prod.mjs --dry-run
 *
 *   # 6. Quando satisfeito, rode pra valer:
 *   node migrate-replit-to-prod.mjs --live
 *
 * O script é idempotente: re-execução pula rows/objetos já presentes no destino.
 */

import { Pool } from "pg";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run") || (!args.has("--live") && !args.has("--inventory"));
const INVENTORY_ONLY = args.has("--inventory");

console.log(`Mode: ${INVENTORY_ONLY ? "INVENTORY ONLY" : DRY_RUN ? "DRY-RUN" : "LIVE"}`);

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SOURCE_DB = requireEnv("DATABASE_URL"); // Replit Postgres
const REPLIT_PRIVATE_OBJECT_DIR = requireEnv("PRIVATE_OBJECT_DIR"); // ex: "/replit-objstore-xxxx/private"

const sourcePool = new Pool({ connectionString: SOURCE_DB, max: 4 });

// Replit Object Storage via sidecar
const REPLIT_SIDECAR = "http://127.0.0.1:1106";
const replitStorage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

// Targets — only required when not inventory-only
let targetPool = null;
let r2 = null;
let R2_ATTACHMENTS, R2_AVATARS;

if (!INVENTORY_ONLY) {
  targetPool = new Pool({ connectionString: requireEnv("PROD_DATABASE_URL"), max: 4 });
  r2 = new S3Client({
    endpoint: requireEnv("PROD_S3_ENDPOINT"),
    region: process.env.PROD_S3_REGION ?? "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("PROD_S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("PROD_S3_SECRET_ACCESS_KEY"),
    },
  });
  R2_ATTACHMENTS = requireEnv("PROD_S3_BUCKET_ATTACHMENTS");
  R2_AVATARS = requireEnv("PROD_S3_BUCKET_AVATARS");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseObjectPath(path) {
  // "/bucket-name/private/uploads/<uuid>" → { bucketName, objectName }
  const parts = path.startsWith("/") ? path.slice(1).split("/") : path.split("/");
  if (parts.length < 2) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

/**
 * file_uploads.object_path is stored as the app's "external" path
 * (e.g. "/objects/uploads/<uuid>"). Convert to the actual Replit storage
 * location by stripping "/objects/" and prepending PRIVATE_OBJECT_DIR.
 *
 * Idempotent: if the path is already absolute (starts with "/replit-objstore-"
 * or just doesn't have the "/objects/" prefix), returns as-is.
 */
function resolveReplitObjectPath(objectPathFromDb) {
  if (objectPathFromDb.startsWith("/objects/")) {
    const entityId = objectPathFromDb.slice("/objects/".length); // "uploads/<uuid>"
    return `${REPLIT_PRIVATE_OBJECT_DIR}/${entityId}`;
  }
  return objectPathFromDb;
}

async function replitObjectExists(objectPath) {
  try {
    const { bucketName, objectName } = parseObjectPath(objectPath);
    const file = replitStorage.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    return exists;
  } catch {
    return false;
  }
}

async function replitDownload(objectPath) {
  const { bucketName, objectName } = parseObjectPath(objectPath);
  const file = replitStorage.bucket(bucketName).file(objectName);
  const [metadata] = await file.getMetadata();
  const chunks = [];
  for await (const c of file.createReadStream()) chunks.push(c);
  return {
    body: Buffer.concat(chunks),
    contentType: metadata.contentType ?? "application/octet-stream",
    size: Number(metadata.size ?? Buffer.concat(chunks).length),
  };
}

async function r2Has(bucket, key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound") return false;
    throw e;
  }
}

async function r2Put(bucket, key, body, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

function safeName(name) {
  if (!name) return "file";
  let n = name.normalize("NFKD").replace(/[^A-Za-z0-9._\- ]/g, "_").replace(/^\.+/, "");
  return n || "file";
}

function extFromMime(mime) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
  };
  return map[(mime || "").toLowerCase()] ?? "bin";
}

// ---------------------------------------------------------------------------
// Inventory (always runs)
// ---------------------------------------------------------------------------

async function inventory() {
  console.log("\n=== INVENTORY: Replit Postgres ===");
  const tables = await sourcePool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  for (const { table_name } of tables.rows) {
    try {
      const r = await sourcePool.query(
        `SELECT count(*)::int AS n FROM "${table_name}"`,
      );
      console.log(`  ${table_name.padEnd(35)} ${r.rows[0].n} rows`);
    } catch (e) {
      console.log(`  ${table_name.padEnd(35)} ERR: ${e.message}`);
    }
  }

  console.log("\n=== INVENTORY: Replit Object Storage ===");
  console.log(`  PRIVATE_OBJECT_DIR = ${REPLIT_PRIVATE_OBJECT_DIR}`);
  const { bucketName: rBucket, objectName: rPrefix } = parseObjectPath(
    REPLIT_PRIVATE_OBJECT_DIR + "/uploads/",
  );
  console.log(`  bucket=${rBucket} prefix=${rPrefix}`);
  const [files] = await replitStorage.bucket(rBucket).getFiles({ prefix: rPrefix });
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += Number(f.metadata.size ?? 0);
  }
  console.log(`  ${files.length} objects | ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);

  if (!INVENTORY_ONLY) {
    console.log("\n=== INVENTORY: Supabase prod (target) ===");
    const t = await targetPool.query(
      `SELECT table_name, (SELECT count(*) FROM information_schema.columns
                           WHERE table_schema='public' AND table_name=t.table_name)::int AS cols
       FROM information_schema.tables t
       WHERE t.table_schema='public' ORDER BY table_name`,
    );
    for (const r of t.rows) {
      const c = await targetPool.query(`SELECT count(*)::int AS n FROM "${r.table_name}"`);
      console.log(`  ${r.table_name.padEnd(35)} ${c.rows[0].n} rows | ${r.cols} cols`);
    }
  }
}

// ---------------------------------------------------------------------------
// Migration steps
// ---------------------------------------------------------------------------

/** Tables to copy 1:1 (data only, schema must already match). Order matters for FKs. */
const COPY_TABLES_IN_ORDER = [
  "users",
  "workspaces",
  "workspace_members",
  "maps",
  "user_map_access",
  "user_workspace_order",
  "map_text_elements",
  "tasks",
  "subtasks",
  "task_activities",
  "task_comments",
  "task_templates",
  "task_template_subtasks",
  "cards",
  "card_connections",
  // map_shapes goes separately because we need to set attachment_id after attachments are migrated
  // user_google_calendar_accounts: skipped — encryption key changed in prod, tokens unusable
  // user_calendar_preferences: copied 1:1 (no encrypted fields)
  "user_calendar_preferences",
];

/** Special: user has avatar_url at source; we need to also populate avatar_storage_path at target.
 * Copy users without avatar_url first, then patch avatars after copying objects. */

async function copyTable(name, opts = {}) {
  const { exclude_columns = [], where = "" } = opts;
  const colsRes = await sourcePool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [name],
  );
  const sourceCols = colsRes.rows.map((r) => r.column_name).filter((c) => !exclude_columns.includes(c));
  if (sourceCols.length === 0) {
    console.log(`  [${name}] skipped (no columns left after exclusion)`);
    return { copied: 0, skipped: 0 };
  }

  // Confirm columns exist on target too
  const targetCols = await targetPool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [name],
  );
  const targetSet = new Set(targetCols.rows.map((r) => r.column_name));
  const finalCols = sourceCols.filter((c) => targetSet.has(c));
  if (finalCols.length === 0) {
    console.log(`  [${name}] WARN: no overlapping columns — table missing in target?`);
    return { copied: 0, skipped: 0 };
  }
  if (finalCols.length < sourceCols.length) {
    console.log(`  [${name}] dropping non-overlapping cols: ${sourceCols.filter((c) => !targetSet.has(c)).join(", ")}`);
  }

  const colList = finalCols.map((c) => `"${c}"`).join(", ");
  const sql = `SELECT ${colList} FROM "${name}" ${where}`;
  const rows = (await sourcePool.query(sql)).rows;
  if (rows.length === 0) {
    console.log(`  [${name}] 0 rows — nothing to copy`);
    return { copied: 0, skipped: 0 };
  }

  if (DRY_RUN) {
    console.log(`  [${name}] DRY-RUN: would insert ${rows.length} rows`);
    return { copied: rows.length, skipped: 0 };
  }

  let copied = 0;
  let skipped = 0;
  for (const row of rows) {
    const placeholders = finalCols.map((_, i) => `$${i + 1}`).join(", ");
    const values = finalCols.map((c) => row[c]);
    try {
      const res = await targetPool.query(
        `INSERT INTO "${name}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values,
      );
      if (res.rowCount === 1) copied++;
      else skipped++;
    } catch (e) {
      console.error(`  [${name}] insert failed for row id=${row.id ?? "?"}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`  [${name}] copied=${copied} skipped(conflict/error)=${skipped} of ${rows.length}`);
  return { copied, skipped };
}

async function migrateAttachments() {
  console.log("\n=== Migrating attachments (file_uploads + attachment_links → attachments + R2) ===");

  // Join file_uploads with attachment_links and the parent entity to derive workspace_id.
  const sql = `
    SELECT
      al.id           AS link_id,
      al.entity_type,
      al.entity_id,
      al.kind,
      al.created_at   AS link_created_at,
      fu.id           AS file_upload_id,
      fu.object_path,
      fu.file_name,
      fu.file_size,
      fu.mime_type,
      fu.uploaded_by,
      -- workspace lookup per entity_type
      CASE al.entity_type
        WHEN 'task' THEN (SELECT workspace_id FROM tasks WHERE id = al.entity_id)
        WHEN 'map'  THEN (SELECT workspace_id FROM maps  WHERE id = al.entity_id)
        WHEN 'card' THEN (SELECT m.workspace_id FROM cards c JOIN maps m ON m.id=c.map_id WHERE c.id = al.entity_id)
      END AS derived_workspace_id
    FROM attachment_links al
    JOIN file_uploads fu ON fu.id = al.file_upload_id
    ORDER BY al.created_at ASC
  `;
  const rows = (await sourcePool.query(sql)).rows;
  console.log(`  ${rows.length} attachment_links found`);

  // file_upload_id → new attachment id (used to update map_shapes.attachment_id later)
  const idMap = new Map();
  let copiedRows = 0, copiedObjects = 0, skipped = 0, errors = 0;

  for (const r of rows) {
    if (!r.derived_workspace_id) {
      console.warn(`  SKIP link=${r.link_id}: orphan (parent ${r.entity_type}=${r.entity_id} not found)`);
      skipped++;
      continue;
    }

    const newAttachmentId = randomUUID();
    const filename = safeName(r.file_name);
    const newStoragePath = `workspace/${r.derived_workspace_id}/${r.entity_type}/${r.entity_id}/${newAttachmentId}-${filename}`;

    // Upload object to R2
    const replitObjectPath = resolveReplitObjectPath(r.object_path);
    let objectMoved = false;
    if (DRY_RUN) {
      const exists = await replitObjectExists(replitObjectPath);
      console.log(`  DRY: would copy ${replitObjectPath} ${exists ? "✓" : "✗ NOT FOUND"} → s3://${R2_ATTACHMENTS}/${newStoragePath}`);
      objectMoved = true;
    } else {
      try {
        if (await r2Has(R2_ATTACHMENTS, newStoragePath)) {
          objectMoved = true;
        } else {
          const obj = await replitDownload(replitObjectPath);
          await r2Put(R2_ATTACHMENTS, newStoragePath, obj.body, r.mime_type || obj.contentType);
          objectMoved = true;
          copiedObjects++;
        }
      } catch (e) {
        console.error(`  ERR object ${r.object_path} (resolved: ${replitObjectPath}) → R2: ${e.message}`);
        errors++;
        continue;
      }
    }

    // Insert attachment row
    if (!DRY_RUN && objectMoved) {
      try {
        const insert = await targetPool.query(
          `INSERT INTO attachments
            (id, workspace_id, task_id, card_id, comment_id, map_id, plan_id,
             bucket, storage_path, original_filename, mime_type, file_size,
             kind, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL,
                   'attachments', $7, $8, $9, $10,
                   $11, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            newAttachmentId,
            r.derived_workspace_id,
            r.entity_type === "task" ? r.entity_id : null,
            r.entity_type === "card" ? r.entity_id : null,
            null, // comment_id never had attachments in old schema
            r.entity_type === "map" ? r.entity_id : null,
            newStoragePath,
            filename,
            r.mime_type,
            r.file_size,
            r.kind ?? "standard",
            r.uploaded_by,
            r.link_created_at,
          ],
        );
        if (insert.rowCount === 1) copiedRows++;
        idMap.set(r.file_upload_id, newAttachmentId);
      } catch (e) {
        console.error(`  ERR insert attachment link=${r.link_id}: ${e.message}`);
        errors++;
      }
    }
  }

  console.log(`  attachments: copied_rows=${copiedRows} copied_objects=${copiedObjects} skipped=${skipped} errors=${errors}`);
  return idMap;
}

async function migrateMapShapes(fileUploadIdMap) {
  console.log("\n=== Migrating map_shapes (with attachment_id remap) ===");
  const rows = (await sourcePool.query(
    `SELECT * FROM map_shapes ORDER BY created_at`,
  )).rows;
  console.log(`  ${rows.length} shapes found`);

  let copied = 0, skipped = 0;
  for (const s of rows) {
    const attachmentId = s.file_upload_id ? fileUploadIdMap.get(s.file_upload_id) ?? null : null;
    if (s.file_upload_id && !attachmentId) {
      console.warn(`  WARN shape ${s.id}: file_upload_id ${s.file_upload_id} has no mapped attachment`);
    }
    if (DRY_RUN) {
      console.log(`  DRY: shape ${s.id} type=${s.type} attachment_id=${attachmentId ?? "—"}`);
      copied++;
      continue;
    }
    try {
      const r = await targetPool.query(
        `INSERT INTO map_shapes
           (id, map_id, type, position_x, position_y, width, height, rotation,
            color, filled, stroke_style, x1, y1, x2, y2, attachment_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [
          s.id, s.map_id, s.type, s.position_x, s.position_y, s.width, s.height,
          s.rotation, s.color, s.filled, s.stroke_style, s.x1, s.y1, s.x2, s.y2,
          attachmentId, s.created_at, s.updated_at,
        ],
      );
      if (r.rowCount === 1) copied++;
      else skipped++;
    } catch (e) {
      console.error(`  ERR shape ${s.id}: ${e.message}`);
    }
  }
  console.log(`  map_shapes: copied=${copied} skipped=${skipped}`);
}

async function migrateAvatars() {
  console.log("\n=== Migrating user avatars ===");
  // avatar_url format: "/api/storage/objects/uploads/<uuid>"
  const rows = (await sourcePool.query(
    `SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''`,
  )).rows;
  console.log(`  ${rows.length} users with avatar`);

  let copied = 0, errors = 0;
  for (const u of rows) {
    const m = u.avatar_url.match(/\/objects\/(.+)$/);
    if (!m) {
      console.warn(`  SKIP user ${u.id}: unrecognized avatar_url ${u.avatar_url}`);
      continue;
    }
    const objectKey = m[1];
    const replitObjectPath = `${REPLIT_PRIVATE_OBJECT_DIR}/${objectKey}`;

    if (!(await replitObjectExists(replitObjectPath))) {
      console.warn(`  SKIP user ${u.id}: avatar object not found in Replit (${replitObjectPath})`);
      continue;
    }

    let body, contentType, ext;
    try {
      const obj = await replitDownload(replitObjectPath);
      body = obj.body;
      contentType = obj.contentType;
      ext = extFromMime(contentType);
    } catch (e) {
      console.error(`  ERR download avatar user=${u.id}: ${e.message}`);
      errors++;
      continue;
    }

    const filename = `avatar.${ext}`;
    const newStoragePath = `user/${u.id}/avatar/${randomUUID()}-${filename}`;
    const newAvatarUrl = `/api/users/${u.id}/avatar`;

    if (DRY_RUN) {
      console.log(`  DRY: user ${u.id} avatar → s3://${R2_AVATARS}/${newStoragePath} (${body.length}B ${contentType})`);
      copied++;
      continue;
    }
    try {
      if (!(await r2Has(R2_AVATARS, newStoragePath))) {
        await r2Put(R2_AVATARS, newStoragePath, body, contentType);
      }
      await targetPool.query(
        `UPDATE users SET avatar_storage_path=$1, avatar_url=$2 WHERE id=$3`,
        [newStoragePath, newAvatarUrl, u.id],
      );
      copied++;
    } catch (e) {
      console.error(`  ERR upload/update avatar user=${u.id}: ${e.message}`);
      errors++;
    }
  }
  console.log(`  avatars: copied=${copied} errors=${errors}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    await inventory();
    if (INVENTORY_ONLY) {
      console.log("\nInventory complete. Re-run with --dry-run to preview migration, then --live to execute.");
      return;
    }

    console.log(`\n=== Migration starting (${DRY_RUN ? "DRY-RUN" : "LIVE"}) ===`);

    // Tables 1:1 (FK-safe order). users include avatar_url copy; we'll patch storage_path after.
    for (const t of COPY_TABLES_IN_ORDER) {
      await copyTable(t);
    }

    // Attachments (with object copy and id remap)
    const fileUploadIdMap = await migrateAttachments();

    // map_shapes (depends on attachments mapping)
    await migrateMapShapes(fileUploadIdMap);

    // Avatars (object copy + denormalized fields update)
    await migrateAvatars();

    console.log(`\n=== Migration ${DRY_RUN ? "DRY-RUN" : "LIVE"} complete ===`);
    if (DRY_RUN) {
      console.log("Re-run with --live to actually write to Supabase prod and R2 prod.");
    }
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    await sourcePool.end();
    if (targetPool) await targetPool.end();
  }
})();
