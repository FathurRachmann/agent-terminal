/**
 * TypeScript language-service navigation (go-to-def / find-refs) with rg fallback.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const MAX_OUT = 10_000;

function clip(s: string, max = MAX_OUT): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

export type TsNavHost = {
  findDefinitions(symbol: string, preferFile?: string): string;
  findReferences(symbol: string, preferFile?: string): string;
  dispose(): void;
};

type FileEntry = { version: string; content: string };

/**
 * Lazy TS language service bound to the nearest tsconfig under workspaceRoot.
 * Falls back gracefully when no config / parse errors.
 */
export function createTsNavHost(workspaceRoot: string): TsNavHost | null {
  const root = path.resolve(workspaceRoot);
  const configPath = ts.findConfigFile(
    root,
    (f) => ts.sys.fileExists(f),
    "tsconfig.json",
  );
  if (!configPath) return null;

  const configFile = ts.readConfigFile(configPath, (f) => ts.sys.readFile(f));
  if (configFile.error) return null;

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );

  const versions = new Map<string, FileEntry>();
  const fileNames = parsed.fileNames.map((f) => path.normalize(f));

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => fileNames,
    getScriptVersion: (fileName) => {
      const n = path.normalize(fileName);
      const entry = versions.get(n);
      if (entry) return entry.version;
      try {
        const content = fs.readFileSync(n, "utf8");
        versions.set(n, { version: "1", content });
        return "1";
      } catch {
        return "0";
      }
    },
    getScriptSnapshot: (fileName) => {
      const n = path.normalize(fileName);
      let entry = versions.get(n);
      if (!entry) {
        try {
          const content = fs.readFileSync(n, "utf8");
          entry = { version: "1", content };
          versions.set(n, entry);
        } catch {
          return undefined;
        }
      }
      return ts.ScriptSnapshot.fromString(entry.content);
    },
    getCurrentDirectory: () => path.dirname(configPath),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  function locateSymbolPosition(
    symbol: string,
    preferFile?: string,
  ): { file: string; pos: number } | null {
    const needle = symbol.trim();
    if (!needle) return null;

    const candidates = preferFile
      ? [
          path.isAbsolute(preferFile)
            ? preferFile
            : path.resolve(root, preferFile),
          ...fileNames,
        ]
      : fileNames;

    const defRe = new RegExp(
      `\\b(function|class|interface|type|enum|const|let|var|export\\s+(?:async\\s+)?function|export\\s+(?:default\\s+)?(?:class|function|const|type|interface))\\s+${escapeReg(
        needle,
      )}\\b`,
    );

    for (const file of candidates) {
      const n = path.normalize(file);
      if (!n.endsWith(".ts") && !n.endsWith(".tsx") && !n.endsWith(".mts")) {
        continue;
      }
      let content = versions.get(n)?.content;
      if (content == null) {
        try {
          content = fs.readFileSync(n, "utf8");
          versions.set(n, { version: "1", content });
        } catch {
          continue;
        }
      }
      const m = defRe.exec(content);
      if (m && m.index != null) {
        // Point at the symbol name, not the keyword.
        const nameIdx = content.indexOf(needle, m.index);
        return { file: n, pos: nameIdx >= 0 ? nameIdx : m.index };
      }
    }

    // Fallback: any occurrence of the identifier in a .ts file
    for (const file of candidates) {
      const n = path.normalize(file);
      if (!/\.tsx?$/.test(n)) continue;
      let content = versions.get(n)?.content;
      if (content == null) {
        try {
          content = fs.readFileSync(n, "utf8");
          versions.set(n, { version: "1", content });
        } catch {
          continue;
        }
      }
      const re = new RegExp(`\\b${escapeReg(needle)}\\b`);
      const m = re.exec(content);
      if (m && m.index != null) return { file: n, pos: m.index };
    }
    return null;
  }

  function formatDefs(
    defs: readonly ts.DefinitionInfo[] | undefined,
  ): string {
    if (!defs?.length) return "(no definitions)";
    return defs
      .slice(0, 20)
      .map((d) => {
        const sf = service.getProgram()?.getSourceFile(d.fileName);
        const start = sf?.getLineAndCharacterOfPosition(d.textSpan.start);
        const line = (start?.line ?? 0) + 1;
        const rel = path.relative(root, d.fileName) || d.fileName;
        return `${rel}:${line}  (${d.kind}) ${d.name || ""}`.trim();
      })
      .join("\n");
  }

  function formatRefs(
    refs: readonly ts.ReferenceEntry[] | undefined,
  ): string {
    if (!refs?.length) return "(no references)";
    const lines: string[] = [];
    for (const r of refs.slice(0, 50)) {
      const sf = service.getProgram()?.getSourceFile(r.fileName);
      const start = sf?.getLineAndCharacterOfPosition(r.textSpan.start);
      const line = (start?.line ?? 0) + 1;
      const rel = path.relative(root, r.fileName) || r.fileName;
      const flag = r.isWriteAccess ? "write" : "ref";
      lines.push(`${rel}:${line}  [${flag}]`);
    }
    return lines.join("\n") || "(no references)";
  }

  return {
    findDefinitions(symbol, preferFile) {
      const loc = locateSymbolPosition(symbol, preferFile);
      if (!loc) return `No TypeScript definition found for "${symbol}".`;
      const defs = service.getDefinitionAtPosition(loc.file, loc.pos);
      return clip(
        `find_symbol (TS LS) "${symbol}" via ${path.relative(root, loc.file)}:\n${formatDefs(defs)}`,
      );
    },
    findReferences(symbol, preferFile) {
      const loc = locateSymbolPosition(symbol, preferFile);
      if (!loc) return `No TypeScript references found for "${symbol}".`;
      const refs = service.getReferencesAtPosition(loc.file, loc.pos);
      return clip(
        `find_references (TS LS) "${symbol}" via ${path.relative(root, loc.file)}:\n${formatRefs(refs)}`,
      );
    },
    dispose() {
      service.dispose();
    },
  };
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cached factory — one LS per workspace root. */
const cache = new Map<string, TsNavHost | null>();

export function getTsNavHost(workspaceRoot: string): TsNavHost | null {
  const key = path.resolve(workspaceRoot);
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const host = createTsNavHost(key);
    cache.set(key, host);
    return host;
  } catch {
    cache.set(key, null);
    return null;
  }
}
