import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  greetingFastReply,
  isTrivialGreeting,
} from "./greeting-fast-path.js";

describe("greeting-fast-path", () => {
  it("matches standalone greets", () => {
    for (const g of [
      "halo",
      "halooo",
      "hai",
      "hello",
      "hi",
      "hey!",
      "Selamat pagi",
      "pagi",
      "ping",
    ]) {
      assert.equal(isTrivialGreeting(g), true, g);
    }
  });

  it("rejects tasks and long prompts", () => {
    for (const g of [
      "halo tolong cek Downloads",
      "hello, fix the bug",
      "hi please open chrome",
      "a".repeat(80),
      "",
    ]) {
      assert.equal(isTrivialGreeting(g), false, g);
    }
  });

  it("replies in Indonesian for halo", () => {
    assert.match(greetingFastReply("halooo"), /Halo/);
    assert.match(greetingFastReply("hello"), /Hi|How can I help/i);
  });
});
