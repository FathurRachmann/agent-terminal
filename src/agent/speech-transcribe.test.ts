import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  AUDIO_EXTS,
  isAudioPath,
  isAudioMime,
  transcribeAudioFile,
  type TranscribeFetch,
} from "./speech-transcribe.js";

describe("speech-transcribe helpers", () => {
  it("detects audio extensions and mimes", () => {
    assert.ok(AUDIO_EXTS.has("m4a"));
    assert.ok(AUDIO_EXTS.has("ogg"));
    assert.equal(isAudioPath("clip.M4A"), true);
    assert.equal(isAudioPath("notes.pdf"), false);
    assert.equal(isAudioMime("audio/mp4"), true);
    assert.equal(isAudioMime("audio/ogg; codecs=opus"), true);
    assert.equal(isAudioMime("image/png"), false);
  });
});

describe("transcribeAudioFile", () => {
  const prevFetch = globalThis.fetch;
  const envKeys = [
    "ROUTER_API_KEY",
    "ROUTER_BASE_URL",
    "STT_MODEL",
    "STT_MAX_UPLOAD_BYTES",
    "STT_TIMEOUT_MS",
  ] as const;
  const prevEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    globalThis.fetch = prevFetch;
    for (const k of envKeys) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
  });

  function snapshotEnv() {
    for (const k of envKeys) prevEnv[k] = process.env[k];
  }

  it("posts multipart to /audio/transcriptions and returns text", async () => {
    snapshotEnv();
    process.env.ROUTER_API_KEY = "test-key";
    process.env.ROUTER_BASE_URL = "http://stt.test/v1";
    process.env.STT_MODEL = "whisper-1";

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stt-"));
    const audioPath = path.join(root, "note.m4a");
    fs.writeFileSync(audioPath, Buffer.from("fake-audio-bytes"));

    let sawUrl = "";
    let sawAuth = "";
    let sawModel = "";
    const mockFetch: TranscribeFetch = async (url, init) => {
      sawUrl = String(url);
      const headers = init?.headers as Record<string, string> | undefined;
      sawAuth = headers?.Authorization ?? "";
      const body = init?.body as FormData;
      sawModel = String(body.get("model") ?? "");
      return new Response(JSON.stringify({ text: "halo dunia dari rekaman" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await transcribeAudioFile(audioPath, { fetchImpl: mockFetch });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.text, "halo dunia dari rekaman");
      assert.equal(result.model, "whisper-1");
      assert.match(sawUrl, /\/audio\/transcriptions$/);
      assert.equal(sawAuth, "Bearer test-key");
      assert.equal(sawModel, "whisper-1");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns clear error when file missing", async () => {
    snapshotEnv();
    process.env.ROUTER_API_KEY = "test-key";
    const result = await transcribeAudioFile("/no/such/file.m4a", {
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not found/i);
  });

  it("returns clear error when ROUTER_API_KEY unset", async () => {
    snapshotEnv();
    delete process.env.ROUTER_API_KEY;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stt-"));
    const audioPath = path.join(root, "note.ogg");
    try {
      fs.writeFileSync(audioPath, Buffer.from("x"));
      const result = await transcribeAudioFile(audioPath, {
        fetchImpl: async () => new Response("{}", { status: 200 }),
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /ROUTER_API_KEY/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces upstream HTTP errors", async () => {
    snapshotEnv();
    process.env.ROUTER_API_KEY = "test-key";
    process.env.ROUTER_BASE_URL = "http://stt.test/v1";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stt-"));
    const audioPath = path.join(root, "note.mp3");
    try {
      fs.writeFileSync(audioPath, Buffer.from("x"));
      const result = await transcribeAudioFile(audioPath, {
        fetchImpl: async () =>
          new Response("quota exceeded", { status: 429 }),
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /429/);
      assert.match(result.error, /quota/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
