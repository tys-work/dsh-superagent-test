#!/usr/bin/env node
/**
 * Discover and run all node:test files without relying on shell globs.
 */

import { readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (extname(entry.name) === ".mjs" && full.includes(`${join(root, "tests")}`)) {
      files.push(full);
    }
  }
}

await walk(join(root, "tests"));
files.sort();
if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
