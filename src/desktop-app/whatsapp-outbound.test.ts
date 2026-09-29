import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWhatsAppAttachablePath,
  sanitizeWhatsAppOutboundText,
} from "./whatsapp-outbound.js";

describe("whatsapp-outbound", () => {
  it("strips lokasi file and absolute paths from chat text", () => {
    const raw = [
      "File Notulensi Bimtek KATA KAMI #2 versi PDF sudah selesai dibuat!",
      "",
      "📍 *Lokasi File:* `/Users/fathurrachman/Downloads/Notulensi_Bimtek_KATA_KAMI_2.pdf`",
      "",
      "Isi PDF:",
      "- Ringkasan 3 materi",
    ].join("\n");
    const clean = sanitizeWhatsAppOutboundText(raw);
    assert.match(clean, /sudah selesai dibuat/i);
    assert.match(clean, /Ringkasan/);
    assert.doesNotMatch(clean, /\/Users\//);
    assert.doesNotMatch(clean, /Lokasi File/i);
    assert.doesNotMatch(clean, /Notulensi_Bimtek_KATA_KAMI_2\.pdf/);
  });

  it("strips generator script mentions in backticks", () => {
    const clean = sanitizeWhatsAppOutboundText(
      "Script: `tmp/bots/create_notulensi.py` — PDF siap.",
    );
    assert.doesNotMatch(clean, /create_notulensi\.py/);
    assert.match(clean, /PDF siap/);
  });

  it("allows PDF attach but blocks .py generators", () => {
    assert.equal(
      isWhatsAppAttachablePath("tmp/bots/Notulensi_Bimtek_KATA_KAMI_2.pdf"),
      true,
    );
    assert.equal(
      isWhatsAppAttachablePath("/Users/me/Downloads/report.docx"),
      true,
    );
    assert.equal(
      isWhatsAppAttachablePath("tmp/bots/create_notulensi.py"),
      false,
    );
    assert.equal(isWhatsAppAttachablePath("tmp/bots/make_doc.js"), false);
  });
});
