/**
 * Speech-to-text via OpenAI-compatible Model Hub `/audio/transcriptions`.
 * Large files are compressed (ffmpeg) and/or split into chunks when needed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AUDIO_EXTS = new Set([
  "m4a",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "aac",
  "flac",
  "webm",
  "mp4", // sometimes used for audio-only containers
]);

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/opus",
  "audio/aac",
  "audio/flac",
  "audio/webm",
  "video/mp4",
]);

/** Default Whisper-compatible upload cap (OpenAI-style). */
export const DEFAULT_STT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 200_000;
const CHUNK_SECONDS = 10 * 60;

export type TranscribeFetch = typeof fetch;

export type TranscribeResult =
  | {
      ok: true;
      text: string;
      model: string;
      truncated: boolean;
      chunks?: number;
    }
  | { ok: false; error: string };

function extOf(filePath: string): string {
  const base = path.basename(filePath);
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function isAudioMime(mime: string | undefined | null): boolean {
  const m = String(mime || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    ?.trim();
  if (!m) return false;
  if (AUDIO_MIMES.has(m)) return true;
  return m.startsWith("audio/");
}

export function isAudioPath(filePath: string): boolean {
  return AUDIO_EXTS.has(extOf(filePath));
}

function clipText(text: string, max = MAX_TRANSCRIPT_CHARS): {
  text: string;
  truncated: boolean;
} {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (cleaned.length <= max) return { text: cleaned, truncated: false };
  return {
    text: `${cleaned.slice(0, max)}\n\n…(transcript truncated)`,
    truncated: true,
  };
}

function sttConfig() {
  const apiKey = (process.env.ROUTER_API_KEY ?? "").trim();
  const baseURL = (
    process.env.ROUTER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "http://127.0.0.1:27128/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.STT_MODEL ?? process.env.WHISPER_MODEL ?? "whisper-1";
  const maxUpload = Number(process.env.STT_MAX_UPLOAD_BYTES);
  const maxUploadBytes =
    Number.isFinite(maxUpload) && maxUpload > 0
      ? maxUpload
      : DEFAULT_STT_MAX_UPLOAD_BYTES;
  const timeoutRaw = Number(process.env.STT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 300_000;
  return { apiKey, baseURL, model, maxUploadBytes, timeoutMs };
}

function runCmd(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: `${cmd} timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else
        resolve({
          ok: false,
          error: `${cmd} exited ${code}: ${stderr.slice(-400)}`,
        });
    });
  });
}

async function ffmpegAvailable(): Promise<boolean> {
  const r = await runCmd("ffmpeg", ["-version"], 10_000);
  return r.ok;
}

/** Compress to mono 16 kHz mp3 — usually enough for Whisper on long meetings. */
async function compressForStt(
  absPath: string,
  destAbs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runCmd(
    "ffmpeg",
    [
      "-y",
      "-i",
      absPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "32k",
      destAbs,
    ],
    600_000,
  );
}

/** Split into fixed-duration mp3 segments for oversized audio. */
async function splitForStt(
  absPath: string,
  outDir: string,
): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  const pattern = path.join(outDir, "chunk-%03d.mp3");
  const r = await runCmd(
    "ffmpeg",
    [
      "-y",
      "-i",
      absPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "32k",
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      pattern,
    ],
    600_000,
  );
  if (!r.ok) return r;
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^chunk-\d+\.mp3$/i.test(f))
    .sort()
    .map((f) => path.join(outDir, f));
  if (!files.length) {
    return { ok: false, error: "ffmpeg produced no audio chunks" };
  }
  return { ok: true, files };
}

function mimeForUpload(filePath: string): string {
  const ext = extOf(filePath);
  if (ext === "mp3" || ext === "mpeg") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg" || ext === "oga" || ext === "opus") return "audio/ogg";
  if (ext === "m4a" || ext === "aac" || ext === "mp4") return "audio/mp4";
  if (ext === "webm") return "audio/webm";
  if (ext === "flac") return "audio/flac";
  return "application/octet-stream";
}

async function postTranscription(options: {
  absPath: string;
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  language?: string;
  fetchImpl: TranscribeFetch;
}): Promise<TranscribeResult> {
  const buf = await fs.promises.readFile(options.absPath);
  const form = new FormData();
  const file = new File([new Uint8Array(buf)], path.basename(options.absPath), {
    type: mimeForUpload(options.absPath),
  });
  form.append("file", file);
  form.append("model", options.model);
  form.append("response_format", "json");
  if (options.language?.trim()) {
    form.append("language", options.language.trim());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(
      `${options.baseURL}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `STT request failed (${response.status}): ${body.slice(0, 400)}`,
      };
    }
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const json = (await response.json()) as { text?: string };
      const clipped = clipText(String(json.text ?? ""));
      if (!clipped.text) {
        return { ok: false, error: "STT returned empty transcript" };
      }
      return {
        ok: true,
        text: clipped.text,
        model: options.model,
        truncated: clipped.truncated,
      };
    }
    const text = clipText(await response.text());
    if (!text.text) {
      return { ok: false, error: "STT returned empty transcript" };
    }
    return {
      ok: true,
      text: text.text,
      model: options.model,
      truncated: text.truncated,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (
      name === "AbortError" ||
      /aborted|terminated|econnreset|socket hang up|fetch failed/i.test(msg)
    ) {
      return {
        ok: false,
        error: `STT request aborted or network dropped (${options.timeoutMs}ms): ${msg}`,
      };
    }
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeUnderLimit(
  absPath: string,
  cfg: ReturnType<typeof sttConfig>,
  fetchImpl: TranscribeFetch,
  language?: string,
): Promise<TranscribeResult> {
  const st = await fs.promises.stat(absPath);
  if (st.size <= cfg.maxUploadBytes) {
    return postTranscription({
      absPath,
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      language,
      fetchImpl,
    });
  }

  const hasFf = await ffmpegAvailable();
  if (!hasFf) {
    return {
      ok: false,
      error: `Audio too large (${Math.ceil(st.size / (1024 * 1024))}MB; max ${Math.floor(cfg.maxUploadBytes / (1024 * 1024))}MB) and ffmpeg is not available to compress/split`,
    };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "stt-prep-"));
  try {
    const compressed = path.join(work, "compressed.mp3");
    const compressedOk = await compressForStt(absPath, compressed);
    if (compressedOk.ok) {
      const cst = await fs.promises.stat(compressed);
      if (cst.size <= cfg.maxUploadBytes) {
        return postTranscription({
          absPath: compressed,
          apiKey: cfg.apiKey,
          baseURL: cfg.baseURL,
          model: cfg.model,
          timeoutMs: cfg.timeoutMs,
          language,
          fetchImpl,
        });
      }
    }

    const chunkDir = path.join(work, "chunks");
    fs.mkdirSync(chunkDir, { recursive: true });
    const sourceForSplit =
      compressedOk.ok && fs.existsSync(compressed) ? compressed : absPath;
    const split = await splitForStt(sourceForSplit, chunkDir);
    if (!split.ok) return split;

    const parts: string[] = [];
    for (let i = 0; i < split.files.length; i++) {
      const chunk = split.files[i]!;
      const cst = await fs.promises.stat(chunk);
      if (cst.size > cfg.maxUploadBytes) {
        return {
          ok: false,
          error: `Audio chunk ${i + 1} still exceeds STT upload limit after compression`,
        };
      }
      const part = await postTranscription({
        absPath: chunk,
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        language,
        fetchImpl,
      });
      if (!part.ok) {
        return {
          ok: false,
          error: `STT failed on chunk ${i + 1}/${split.files.length}: ${part.error}`,
        };
      }
      parts.push(part.text);
    }
    const clipped = clipText(parts.join("\n\n"));
    return {
      ok: true,
      text: clipped.text,
      model: cfg.model,
      truncated: clipped.truncated,
      chunks: split.files.length,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Transcribe a local audio file via Model Hub STT.
 */
export async function transcribeAudioFile(
  audioPath: string,
  options?: {
    language?: string;
    fetchImpl?: TranscribeFetch;
  },
): Promise<TranscribeResult> {
  const abs = path.resolve(String(audioPath || "").trim());
  if (!abs) return { ok: false, error: "audio path required" };
  if (!fs.existsSync(abs)) {
    return { ok: false, error: `Audio file not found at '${abs}'` };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return { ok: false, error: `Audio file not found at '${abs}'` };
  }
  if (!st.isFile() || st.size <= 0) {
    return { ok: false, error: "Audio file is empty" };
  }

  const cfg = sttConfig();
  if (!cfg.apiKey) {
    return {
      ok: false,
      error: "ROUTER_API_KEY is not set — cannot call STT",
    };
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  return transcribeUnderLimit(abs, cfg, fetchImpl, options?.language);
}
