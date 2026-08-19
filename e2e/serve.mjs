// Static server for the built SPA + /api proxy to the Express dev server.
// Keeps the e2e run light: one bundle instead of Vite's hundreds of dev modules
// (which exhausted the browser with ERR_INSUFFICIENT_RESOURCES on this machine).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3] ?? 3100);
const API = process.argv[4] ?? "http://localhost:5000";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    const target = new URL(req.url, API);
    const proxied = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: target.host } },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on("error", (err) => { res.writeHead(502); res.end(String(err)); });
    req.pipe(proxied);
    return;
  }

  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, "index.html"); // SPA fallback
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
  res.end(body);
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT} (api -> ${API})`));
