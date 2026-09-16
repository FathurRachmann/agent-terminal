import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractChatContextFromTurn,
  isChatContextContent,
} from "./chat-context.js";

describe("chat-context", () => {
  it("extracts explicit ingat / remember instructions", () => {
    const items = extractChatContextFromTurn({
      userPrompt:
        "Ingat: kalau kirim laporan Word ke WhatsApp, selalu kirim file .docx-nya juga",
    });
    assert.ok(items.some((i) => i.kind === "remember"));
    assert.ok(
      items.some((i) => /CHAT remember:.*\.docx/i.test(i.text)),
      JSON.stringify(items),
    );
  });

  it("extracts corrections from pushback", () => {
    const items = extractChatContextFromTurn({
      userPrompt:
        "Salah, yang benar kirim file hasilnya ke WhatsApp jangan cuma path-nya",
      assistantResponse: "File ada di working/foo.doc",
    });
    assert.ok(items.some((i) => i.kind === "correction"));
    assert.ok(isChatContextContent(items[0]!.text));
  });

  it("extracts standing context from dari sekarang / always", () => {
    const items = extractChatContextFromTurn({
      userPrompt: "Dari sekarang selalu balas singkat dulu baru detail",
    });
    assert.ok(items.some((i) => i.kind === "context"));
    assert.match(items[0]!.text, /CHAT context:/);
  });

  it("ignores short non-corrective chat", () => {
    const items = extractChatContextFromTurn({
      userPrompt: "ok",
    });
    assert.equal(items.length, 0);
  });
});
