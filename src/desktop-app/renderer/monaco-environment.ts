/**
 * Configure @monaco-editor/react to use the bundled monaco-editor package.
 * Avoids Vite/Rolldown `?worker` path resolution failures.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

let configured = false;

export function ensureMonacoEnvironment(): void {
  if (configured) return;
  loader.config({ monaco });
  configured = true;
}
