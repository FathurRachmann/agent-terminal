/**
 * resolve hook for @/* → <root>/src/*, open-sse/* → <root>/open-sse/*, next shims
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

let root = null;

export async function initialize(data) {
  root = data?.root;
}

function resolveFile(baseNoExt) {
  const candidates = [
    baseNoExt,
    `${baseNoExt}.js`,
    `${baseNoExt}.mjs`,
    `${baseNoExt}.cjs`,
    path.join(baseNoExt, "index.js"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return pathToFileURL(c).href;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (!root) {
    return nextResolve(specifier, context);
  }

  if (specifier === "next/server") {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(root, "shims", "next-server.js")).href,
    };
  }
  if (specifier === "next/headers") {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(root, "shims", "next-headers.js")).href,
    };
  }
  if (specifier === "node-machine-id") {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(root, "shims", "node-machine-id.js")).href,
    };
  }

  if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    const rel =
      specifier === "open-sse"
        ? "index.js"
        : specifier.slice("open-sse/".length);
    const abs = path.join(root, "open-sse", rel.replace(/^\//, ""));
    const url = resolveFile(abs.replace(/\.js$/, "")) || resolveFile(abs);
    if (url) return { shortCircuit: true, url };
    if (fs.existsSync(abs)) {
      return { shortCircuit: true, url: pathToFileURL(abs).href };
    }
  }

  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const abs = path.join(root, "src", rel);
    const url = resolveFile(abs.replace(/\.js$/, "")) || resolveFile(abs);
    if (url) return { shortCircuit: true, url };
    if (fs.existsSync(abs)) {
      return { shortCircuit: true, url: pathToFileURL(abs).href };
    }
  }

  return nextResolve(specifier, context);
}
