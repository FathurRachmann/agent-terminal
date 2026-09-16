import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ErrorBuffer,
  fingerprintError,
  isSelfHealEligibleError,
  parseSelfHealCommand,
  SelfHealController,
} from "./index.js";

describe("parseSelfHealCommand", () => {
  it("matches bare /self-heal", () => {
    assert.deepEqual(parseSelfHealCommand("/self-heal"), { note: "" });
  });

  it("captures trailing note", () => {
    assert.deepEqual(parseSelfHealCommand("/self-heal fix playwright"), {
      note: "fix playwright",
    });
  });

  it("rejects normal prompts", () => {
    assert.equal(parseSelfHealCommand("please self-heal"), null);
  });
});

describe("fingerprintError", () => {
  it("collapses volatile path/number noise", () => {
    const a = fingerprintError(
      "Executable doesn't exist at /Users/fathurrachman/Library/Caches/ms-playwright/chromium-1234/chrome",
    );
    const b = fingerprintError(
      "Executable doesn't exist at /Users/other/Library/Caches/ms-playwright/chromium-9999/chrome",
    );
    assert.equal(a, b);
  });
});

describe("isSelfHealEligibleError", () => {
  it("blocks opaque provider TypeErrors that self-heal cannot fix", () => {
    assert.equal(
      isSelfHealEligibleError(
        "Cannot read properties of undefined (reading 'message')",
      ),
      false,
    );
  });

  it("allows ordinary code/process failures", () => {
    assert.equal(
      isSelfHealEligibleError("ENOENT: no such file or directory"),
      true,
    );
  });

  it("blocks auth / busy errors", () => {
    assert.equal(isSelfHealEligibleError("Invalid API key"), false);
    assert.equal(
      isSelfHealEligibleError("This session is already running a turn."),
      false,
    );
  });
});

describe("SelfHealController", () => {
  it("auto-triggers after threshold identical errors", () => {
    const c = new SelfHealController({
      errorThreshold: 2,
      cooldownMs: 0,
    });
    c.recordTurnError("ENOENT: missing file boom");
    assert.equal(c.shouldAutoTrigger(true), false);
    c.recordTurnError("ENOENT: missing file boom");
    assert.equal(c.shouldAutoTrigger(true), true);
  });

  it("rejects concurrent begin", () => {
    const c = new SelfHealController({ cooldownMs: 0 });
    assert.equal(c.begin("manual").ok, true);
    assert.equal(c.begin("manual").ok, false);
  });
});

describe("ErrorBuffer.snapshot", () => {
  it("formats recent errors", () => {
    const buf = new ErrorBuffer();
    buf.push("first", "turn");
    buf.push("second", "turn");
    assert.match(buf.snapshot(), /first/);
    assert.match(buf.snapshot(), /second/);
  });
});
