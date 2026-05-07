import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

const corsRules = [
  {
    AllowedOrigins: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5000",
    ],
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

const buckets = ["bloquim-attachments", "bloquim-avatars"];

for (const bucket of buckets) {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: corsRules },
    }),
  );
  const verify = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(`[${bucket}] applied:`, JSON.stringify(verify.CORSRules, null, 2));
}
