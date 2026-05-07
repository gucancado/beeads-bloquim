/**
 * Smoke test against production R2 buckets: PUT → GET → DELETE on each.
 *
 * Reads credentials from env. Pass them explicitly (do NOT use the dev .env):
 *
 *   S3_ENDPOINT='https://<account>.r2.cloudflarestorage.com' \
 *   S3_ACCESS_KEY_ID=... \
 *   S3_SECRET_ACCESS_KEY=... \
 *   node lib/storage/smoke-prod-r2.mjs
 *
 * Override the bucket list with BUCKETS=foo,bar if needed.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const env = process.env;
for (const key of ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

const buckets = (env.BUCKETS ??
  "bloquim-attachments-prod,bloquim-avatars-prod,bloquim-public-assets-prod,bloquim-backups-prod"
).split(",").map((s) => s.trim()).filter(Boolean);

const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

let failed = 0;
for (const bucket of buckets) {
  const key = "smoke/probe.txt";
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: "smoke prod ok", ContentType: "text/plain",
    }));
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await got.Body.transformToString();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`[${bucket}] PUT+GET+DELETE ok (body="${body}")`);
  } catch (e) {
    console.log(`[${bucket}] FAILED:`, e.name, e.message);
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);
