import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findFuzzyLineMatches,
  looksLikeEditFailure,
  snippetAroundMatch,
} from "./edit-retry-middleware.js";
import {
  compactToolOutput,
  extractSignalLines,
} from "./tool-result-compact-middleware.js";
import { getTsNavHost } from "./ts-nav.js";

describe("edit-retry helpers", () => {
  it("detects old_string failures", () => {
    assert.equal(
      looksLikeEditFailure("Error: old_string not found in file"),
      true,
    );
    assert.equal(looksLikeEditFailure("Successfully updated file.ts"), false);
  });

  it("finds fuzzy line matches", () => {
    const file = ["export function foo() {", "  return 1;", "}"].join("\n");
    const hits = findFuzzyLineMatches(file, "export function foo() {");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.line, 1);
  });

  it("snippetAroundMatch returns numbered window", () => {
    const file = ["a", "b", "TARGET", "c", "d"].join("\n");
    const snip = snippetAroundMatch(file, "TARGET", 1);
    assert.ok(snip);
    assert.match(snip!, /TARGET/);
    assert.match(snip!, /3\|/);
  });
});

describe("tool-result compact", () => {
  it("extracts signal lines", () => {
    const text = ["ok", "Error: boom", "src/a.ts:12: TypeError", "done"].join(
      "\n",
    );
    const sig = extractSignalLines(text);
    assert.ok(sig.some((l) => /Error: boom/.test(l)));
    assert.ok(sig.some((l) => /a\.ts:12/.test(l)));
  });

  it("compacts oversized output and keeps signals", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    lines[200] = "TypeError: cannot read";
    const big = lines.join("\n");
    const { text, compacted } = compactToolOutput(big, { maxChars: 2_000 });
    assert.equal(compacted, true);
    assert.match(text, /omitted|compacted/i);
    assert.match(text, /TypeError/);
  });
});

describe("ts-nav", () => {
  it("creates a language service host for this repo", () => {
    const host = getTsNavHost(process.cwd());
    assert.ok(host);
    const defs = host!.findDefinitions("createCodingTools");
    assert.match(defs, /createCodingTools|coding-tools/i);
  });
});
