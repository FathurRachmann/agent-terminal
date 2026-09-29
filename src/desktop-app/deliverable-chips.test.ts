import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeliverableFileChips } from "./deliverable-chips.js";
import {
  collectChatFileChipPaths,
  isProseFalsePositivePath,
} from "./file-delivery-shared.js";

describe("deliverable-chips", () => {
  it("emits a file card for absolute PDF paths in backticks", () => {
    const chips = buildDeliverableFileChips(
      [
        "File di `/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf`",
      ],
      [],
      "12:00:00",
    );
    assert.equal(chips.length, 1);
    assert.equal(chips[0]?.kind, "file");
    assert.equal(
      chips[0]?.path,
      "/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf",
    );
  });

  it("re-emits the same path for a later turn (no dedupe across turns)", () => {
    const text =
      "`/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf`";
    const a = buildDeliverableFileChips([text], [], "1");
    const b = buildDeliverableFileChips([text], [], "2");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0]?.path, b[0]?.path);
    assert.notEqual(a[0]?.id, b[0]?.id);
  });

  it("does not chip architecture prose false-positives", () => {
    const text = `
Stack: Next.js 14, middleware.js, filterResponse.js, cloudbuild.yaml,
src/services/endpoint/*.js, domain simkopdes.go.id, and BFF.
`;
    const chips = buildDeliverableFileChips([text], [], "12:00:00");
    assert.equal(chips.length, 0);
  });

  it("still chips real working/ deliverables + write extras", () => {
    const chips = buildDeliverableFileChips(
      ["Diagram saved to tmp/bots/user_login_diagram.mmd"],
      ["tmp/bots/user_login_diagram.mmd"],
      "12:00:00",
    );
    assert.ok(chips.some((c) => c.path.includes("user_login_diagram.mmd")));
  });
});

describe("prose false-positive paths", () => {
  it("flags Next.js, domains, globs, bare source files", () => {
    assert.equal(isProseFalsePositivePath("Next.js"), true);
    assert.equal(isProseFalsePositivePath("simkopdes.go.id"), true);
    assert.equal(isProseFalsePositivePath("src/services/endpoint/*.js"), true);
    assert.equal(isProseFalsePositivePath("middleware.js"), true);
    assert.equal(isProseFalsePositivePath("cloudbuild.yaml"), true);
    assert.equal(
      isProseFalsePositivePath("tmp/bots/user_login_diagram.mmd"),
      false,
    );
  });

  it("collectChatFileChipPaths drops prose noise", () => {
    const paths = collectChatFileChipPaths([
      "Next.js + middleware.js + tmp/bots/diagram.mmd",
    ]);
    assert.deepEqual(paths, ["tmp/bots/diagram.mmd"]);
  });
});
