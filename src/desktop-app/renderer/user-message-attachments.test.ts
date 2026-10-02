import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUserMessageContent } from "./user-message-attachments.js";

describe("parseUserMessageContent", () => {
  it("extracts image paths and strips attachment wrapper", () => {
    const content = `[ATTACHMENTS]
The user attached the following file(s).
- IMAGE: \`tmp/uploads/shot.png\` (image/png, 12 bytes). Call vision_analyze…
[/ATTACHMENTS]

[USER]
gambar apa ini?`;
    const parsed = parseUserMessageContent(content);
    assert.equal(parsed.text, "gambar apa ini?");
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0]?.kind, "image");
    assert.equal(parsed.attachments[0]?.path, "tmp/uploads/shot.png");
    assert.equal(parsed.attachments[0]?.basename, "shot.png");
  });

  it("returns plain text unchanged when no attachments block", () => {
    const parsed = parseUserMessageContent("hello");
    assert.equal(parsed.text, "hello");
    assert.equal(parsed.attachments.length, 0);
  });

  it("clears default analyze placeholder when only images", () => {
    const content = `[ATTACHMENTS]
- IMAGE: \`tmp/uploads/a.png\` (image/png, 1 bytes).
[/ATTACHMENTS]

[USER]
Please analyze the attached image(s) and respond helpfully.`;
    const parsed = parseUserMessageContent(content);
    assert.equal(parsed.text, "");
    assert.equal(parsed.attachments[0]?.basename, "a.png");
  });

  it("extracts audio paths from AUDIO lines", () => {
    const content = `[ATTACHMENTS]
- AUDIO: \`tmp/global/uploads/meeting.m4a\` (audio/mp4, 100 bytes).
[/ATTACHMENTS]

[USER]
tolong buatkan notulensinya`;
    const parsed = parseUserMessageContent(content);
    assert.equal(parsed.text, "tolong buatkan notulensinya");
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0]?.kind, "audio");
    assert.equal(parsed.attachments[0]?.basename, "meeting.m4a");
  });
});
