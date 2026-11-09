#!/usr/bin/env node
/**
 * Zero-dependency static server for local development.
 *
 *   npm start            -> http://localhost:4173
 *   PORT=8080 npm start
 *
 * The app is a static site; any static server works (for example
 * `python3 -m http.server 4173` from this directory).
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname);
  } catch {
    send(response, 400, "Bad Request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = resolve(target, "index.html");
    const body = await readFile(target);
    send(response, 200, request.method === "HEAD" ? undefined : body, {
      "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
    });
  } catch {
    send(response, 404, "Not Found");
  }
});

server.listen(port, host, () => {
  const addresses = ["http://localhost:" + port];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const network of interfaces || []) {
      if (network.family === "IPv4" && !network.internal) {
        addresses.push(`http://${network.address}:${port}`);
      }
    }
  }
  console.log("随墨 Suimo is running:");
  for (const address of addresses) console.log(`  ${address}`);
  console.log("在平板上打开局域网地址即可；按 Ctrl+C 停止。");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
