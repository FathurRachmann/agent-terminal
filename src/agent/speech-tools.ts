import { tool } from "langchain";
import { z } from "zod";
import path from "node:path";
import { transcribeAudioFile } from "./speech-transcribe.js";

/**
 * On-demand speech-to-text for local audio (WhatsApp voice, .m4a meetings, etc.).
 */
export function createSpeechTools(workspaceRoot?: string) {
  const root = workspaceRoot ? path.resolve(workspaceRoot) : undefined;

  const speechTranscribe = tool(
    async ({
      audio_path,
      language,
    }: {
      audio_path: string;
      language?: string;
    }) => {
      const trimmed = String(audio_path || "").trim();
      if (!trimmed) return "Error: audio_path required";
      const abs = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(root || process.cwd(), trimmed);
      const result = await transcribeAudioFile(abs, { language });
      if (!result.ok) {
        return `Speech transcription failed for '${trimmed}': ${result.error}`;
      }
      const notes: string[] = [];
      if (result.chunks && result.chunks > 1) {
        notes.push(`${result.chunks} chunks`);
      }
      if (result.truncated) notes.push("truncated");
      const suffix = notes.length ? ` (${notes.join(", ")})` : "";
      return `Transcript${suffix} from ${trimmed} [model=${result.model}]:\n\n${result.text}`;
    },
    {
      name: "speech_transcribe",
      description:
        "Transcribe a local audio/voice file (m4a, mp3, ogg/opus, wav, aac, flac, webm) to text via Model Hub STT. Prefer this for voice memos and meeting recordings. Large files are auto-compressed/split when ffmpeg is available.",
      schema: z.object({
        audio_path: z
          .string()
          .describe(
            "Workspace-relative or absolute path to the audio file (e.g. tmp/global/uploads/wa-audio-….ogg)",
          ),
        language: z
          .string()
          .optional()
          .describe(
            "Optional BCP-47 / ISO-639-1 language hint (e.g. id, en). Leave unset for auto-detect.",
          ),
      }),
    },
  );

  return [speechTranscribe];
}
