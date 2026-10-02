import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPlanForWhatsApp,
  parseWhatsAppPlanReply,
} from "./whatsapp-plan-approval.js";

describe("parseWhatsAppPlanReply", () => {
  it("approves common Indonesian/English yes words", () => {
    for (const w of ["setuju", "Setuju", "ya", "ok", "lanjut", "approve", "YES"]) {
      assert.equal(parseWhatsAppPlanReply(w), "approve", w);
    }
  });

  it("rejects common no words", () => {
    for (const w of ["tolak", "Tolak", "tidak", "reject", "batal", "no"]) {
      assert.equal(parseWhatsAppPlanReply(w), "reject", w);
    }
  });

  it("returns null for unrelated chat", () => {
    assert.equal(parseWhatsAppPlanReply("tolong buatkan laporan"), null);
    assert.equal(parseWhatsAppPlanReply(""), null);
  });
});

describe("formatPlanForWhatsApp", () => {
  it("includes goal, plan, todos, and reply hint", () => {
    const text = formatPlanForWhatsApp({
      goal: "Buat laporan",
      plan: "1. Draft\n2. Review",
      todos: [{ id: "1", content: "Tulis sampul" }],
    });
    assert.match(text, /Buat laporan/);
    assert.match(text, /Draft/);
    assert.match(text, /Tulis sampul/);
    assert.match(text, /setuju/i);
    assert.match(text, /tolak/i);
  });
});
