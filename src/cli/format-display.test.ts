import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAgentDisplayText } from "./format-display.js";

describe("formatAgentDisplayText", () => {
  it("breaks jammed numbered sections and strips bold", () => {
    const raw =
      "terdiri dari 2 layer utama:1. **Persistent Layer (Otomatis)**2. **Long-term Cognitive Layer (Selektif)**";
    const out = formatAgentDisplayText(raw);
    assert.match(out, /utama:\n\n1\. Persistent Layer \(Otomatis\)/);
    assert.match(out, /\n\n2\. Long-term Cognitive Layer \(Selektif\)/);
    assert.doesNotMatch(out, /\*\*/);
  });

  it("breaks inline bullets onto new lines", () => {
    const raw =
      "(Otomatis): - Artinya layer otomatis. - Menyimpan transcript.";
    const out = formatAgentDisplayText(raw);
    assert.match(out, /:\n {2}- Artinya/);
    assert.match(out, /\n {2}- Menyimpan/);
  });
});
