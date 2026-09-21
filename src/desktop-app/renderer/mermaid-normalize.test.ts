import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMermaidSource } from "./mermaid-normalize.js";

describe("normalizeMermaidSource", () => {
  it("strips trailing dashes after arrow target", () => {
    const raw = "sequenceDiagram\n  API-->>Frontend----------------";
    assert.equal(
      normalizeMermaidSource(raw),
      "sequenceDiagram\n  API-->>Frontend",
    );
  });

  it("strips dashes between target and colon", () => {
    const raw =
      "sequenceDiagram\n  Frontend-->>API-----------------------: ok";
    assert.equal(
      normalizeMermaidSource(raw),
      "sequenceDiagram\n  Frontend-->>API: ok",
    );
  });

  it("inserts missing colon after sequence arrow before free text", () => {
    const raw =
      "sequenceDiagram\n  Frontend->>API includes input validation, branching untuk us -----------------------";
    const out = normalizeMermaidSource(raw);
    assert.equal(
      out,
      "sequenceDiagram\n  Frontend->>API: includes input validation, branching untuk us",
    );
  });

  it("inserts missing colon on Note over A, B …", () => {
    const raw =
      "sequenceDiagram\n  Note over Frontend, API includes input validation, branching untuk us -----------------------";
    assert.equal(
      normalizeMermaidSource(raw),
      "sequenceDiagram\n  Note over Frontend, API: includes input validation, branching untuk us",
    );
  });

  it("keeps valid diagram lines unchanged", () => {
    const raw = "flowchart TD\n  A[Start] --> B[Done]";
    assert.equal(normalizeMermaidSource(raw), raw);
  });

  it("does not double-insert colon when already present", () => {
    const raw = "sequenceDiagram\n  A->>B: hello\n  Note over A, B: hi";
    assert.equal(normalizeMermaidSource(raw), raw);
  });
});
