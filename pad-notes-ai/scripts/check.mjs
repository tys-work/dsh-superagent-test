#!/usr/bin/env node
/**
 * Syntax + asset-reference check, with no dependencies.
 * Runs `node --check` on every JS module and verifies that local files
 * referenced by index.html / manifest exist.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const IGNORED = new Set(["node_modules", ".git", "docs", "screenshots"]);
const errors = [];
let checked = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if ([".js", ".mjs"].includes(extname(entry.name))) {
      checked += 1;
      const result = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
      if (result.status !== 0) {
        errors.push(`${relative(root, full)}\n${result.stderr.trim()}`);
      }
    }
  }
}

async function checkReferences() {
  const html = await readFile(join(root, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((ref) => !/^(?:https?:|data:|mailto:|#)/.test(ref));
  for (const ref of new Set(refs)) {
    try {
      await stat(join(root, ref.replace(/^\.\//, "")));
    } catch {
      errors.push(`index.html references missing file: ${ref}`);
    }
  }

  const manifest = JSON.parse(await readFile(join(root, "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons || []) {
    try {
      await stat(join(root, icon.src));
    } catch {
      errors.push(`manifest references missing icon: ${icon.src}`);
    }
  }
}

await walk(root);
await checkReferences();

if (errors.length) {
  console.error("Checks failed:\n\n" + errors.join("\n\n"));
  process.exit(1);
}
console.log(`OK · ${checked} JavaScript modules parsed, local asset references resolved.`);
