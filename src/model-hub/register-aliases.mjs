/**
 * Node custom loader: map 9Router path aliases onto this source tree.
 * Usage: node --import ./src/model-hub/register-aliases.mjs …
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

register(pathToFileURL(path.join(here, "alias-hooks.mjs")).href, {
  parentURL: pathToFileURL(here + "/").href,
  data: { root: here },
});
