/** Detect and convert SQL DDL (CREATE TABLE) into Mermaid ER + DBML. */

export type SqlColumn = {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
  unique?: boolean;
  notNull?: boolean;
};

export type SqlTable = {
  name: string;
  columns: SqlColumn[];
};

export type SqlRelation = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type SqlSchemaModel = {
  tables: SqlTable[];
  relations: SqlRelation[];
};

export function looksLikeSqlSchema(code: string): boolean {
  return /\bcreate\s+table\b/i.test(code);
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function cleanIdent(raw: string): string {
  return raw.replace(/^[`"\[]|[`"\]]$/g, "").trim();
}

function parseColumnLine(line: string): SqlColumn | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (
    /^(constraint|primary\s+key|foreign\s+key|unique|check|index)\b/i.test(
      trimmed,
    )
  ) {
    return null;
  }

  const m = trimmed.match(
    /^([`"\[]?[\w.-]+[`"\]]?)\s+([a-zA-Z][\w\s().]*)/i,
  );
  if (!m) return null;
  const name = cleanIdent(m[1]!);
  let type = m[2]!.trim();
  // Cut type at constraint keywords
  type = type
    .split(
      /\s+(?=(?:not\s+null|null|primary\s+key|unique|default|references|check|collate)\b)/i,
    )[0]!
    .trim()
    .replace(/\s+/g, " ");

  const upper = trimmed.toUpperCase();
  return {
    name,
    type: type || "unknown",
    pk: /\bprimary\s+key\b/i.test(trimmed),
    unique: /\bunique\b/i.test(trimmed),
    notNull: /\bnot\s+null\b/i.test(trimmed),
    fk: /\breferences\b/i.test(trimmed),
  };
}

function parseTableBodyConstraints(
  tableName: string,
  parts: string[],
  relations: SqlRelation[],
  columns: SqlColumn[],
) {
  for (const part of parts) {
    const pk = part.match(
      /^primary\s+key\s*\(([^)]+)\)/i,
    );
    if (pk) {
      const names = pk[1]!.split(",").map((s) => cleanIdent(s));
      for (const col of columns) {
        if (names.includes(col.name)) col.pk = true;
      }
      continue;
    }

    const fk = part.match(
      /^(?:constraint\s+\w+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([`"\[]?[\w.-]+[`"\]]?)\s*\(([^)]+)\)/i,
    );
    if (fk) {
      const fromCols = fk[1]!.split(",").map((s) => cleanIdent(s));
      const toTable = cleanIdent(fk[2]!);
      const toCols = fk[3]!.split(",").map((s) => cleanIdent(s));
      fromCols.forEach((fromColumn, i) => {
        const col = columns.find((c) => c.name === fromColumn);
        if (col) col.fk = true;
        relations.push({
          fromTable: tableName,
          fromColumn,
          toTable,
          toColumn: toCols[i] || toCols[0] || "id",
        });
      });
    }
  }
}

function parseInlineReferences(
  tableName: string,
  columnLines: string[],
  relations: SqlRelation[],
) {
  for (const line of columnLines) {
    const m = line.match(
      /^([`"\[]?[\w.-]+[`"\]]?)\s+[\w\s().]*?\breferences\s+([`"\[]?[\w.-]+[`"\]]?)\s*(?:\(([^)]+)\))?/i,
    );
    if (!m) continue;
    const fromColumn = cleanIdent(m[1]!);
    const toTable = cleanIdent(m[2]!);
    const toColumn = cleanIdent(m[3] || "id");
    relations.push({
      fromTable: tableName,
      fromColumn,
      toTable,
      toColumn,
    });
  }
}

/** Parse CREATE TABLE statements into tables + FK relations. */
export function parseSqlSchema(sql: string): SqlSchemaModel {
  const cleaned = stripSqlComments(sql);
  const tables: SqlTable[] = [];
  const relations: SqlRelation[] = [];

  const re =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([`"\[]?[\w.-]+[`"\]]?)\s*\(([\s\S]*?)\)\s*(?:;|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const name = cleanIdent(match[1]!);
    const body = match[2] || "";
    const parts = splitTopLevelCommas(body);
    const columns: SqlColumn[] = [];
    for (const part of parts) {
      const col = parseColumnLine(part);
      if (col) columns.push(col);
    }
    parseTableBodyConstraints(name, parts, relations, columns);
    parseInlineReferences(name, parts, relations);
    if (columns.length) tables.push({ name, columns });
  }

  // Dedupe relations
  const seen = new Set<string>();
  const uniqueRelations = relations.filter((r) => {
    const key = `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { tables, relations: uniqueRelations };
}

function mermaidType(type: string): string {
  return type.replace(/[^\w]/g, "_").replace(/_+/g, "_") || "unknown";
}

function mermaidIdent(name: string): string {
  // Mermaid entity/attr names: keep alphanumerics and underscore
  return name.replace(/[^\w]/g, "_");
}

/** Convert parsed schema to Mermaid erDiagram source. */
export function schemaToMermaidEr(model: SqlSchemaModel): string {
  if (!model.tables.length) return "";
  const lines: string[] = ["erDiagram"];
  for (const rel of model.relations) {
    lines.push(
      `  ${mermaidIdent(rel.toTable)} ||--o{ ${mermaidIdent(rel.fromTable)} : "${mermaidIdent(rel.fromColumn)}"`,
    );
  }
  for (const table of model.tables) {
    lines.push(`  ${mermaidIdent(table.name)} {`);
    for (const col of table.columns) {
      const keys: string[] = [];
      if (col.pk) keys.push("PK");
      if (col.fk) keys.push("FK");
      if (col.unique && !col.pk) keys.push("UK");
      const keySuffix = keys.length ? ` ${keys.join(",")}` : "";
      lines.push(
        `    ${mermaidType(col.type)} ${mermaidIdent(col.name)}${keySuffix}`,
      );
    }
    lines.push("  }");
  }
  return lines.join("\n");
}

/** Convert parsed schema to DBML (dbdiagram.io). */
export function schemaToDbml(model: SqlSchemaModel): string {
  if (!model.tables.length) return "";
  const blocks: string[] = [];
  for (const table of model.tables) {
    const cols = table.columns.map((col) => {
      const attrs: string[] = [];
      if (col.pk) attrs.push("pk");
      if (col.notNull && !col.pk) attrs.push("not null");
      if (col.unique && !col.pk) attrs.push("unique");
      const attr = attrs.length ? ` [${attrs.join(", ")}]` : "";
      return `  ${col.name} ${col.type}${attr}`;
    });
    blocks.push(`Table ${table.name} {\n${cols.join("\n")}\n}`);
  }
  for (const rel of model.relations) {
    blocks.push(
      `Ref: ${rel.fromTable}.${rel.fromColumn} > ${rel.toTable}.${rel.toColumn}`,
    );
  }
  return blocks.join("\n\n");
}

export function sqlToMermaidEr(sql: string): string {
  return schemaToMermaidEr(parseSqlSchema(sql));
}

export function sqlToDbml(sql: string): string {
  return schemaToDbml(parseSqlSchema(sql));
}

/** Best-effort DBML → Mermaid ER for preview. */
export function dbmlToMermaidEr(dbml: string): string {
  const tables: SqlTable[] = [];
  const relations: SqlRelation[] = [];
  const tableRe = /table\s+([`"\[]?[\w.-]+[`"\]]?)\s*\{([^}]*)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(dbml)) !== null) {
    const name = cleanIdent(m[1]!);
    const columns: SqlColumn[] = [];
    for (const line of m[2]!.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("//") || t.startsWith("Note")) continue;
      const cm = t.match(/^([\w.-]+)\s+([^\[]+?)(?:\s*\[([^\]]*)\])?\s*$/);
      if (!cm) continue;
      const attrs = (cm[3] || "").toLowerCase();
      columns.push({
        name: cleanIdent(cm[1]!),
        type: cm[2]!.trim(),
        pk: /\bpk\b|\bprimary\s*key\b/.test(attrs),
        unique: /\bunique\b/.test(attrs),
        notNull: /\bnot\s*null\b/.test(attrs),
      });
    }
    if (columns.length) tables.push({ name, columns });
  }
  const refRe =
    /ref:\s*([`"\[]?[\w.-]+[`"\]]?)\.([`"\[]?[\w.-]+[`"\]]?)\s*[<>\-]+\s*([`"\[]?[\w.-]+[`"\]]?)\.([`"\[]?[\w.-]+[`"\]]?)/gi;
  while ((m = refRe.exec(dbml)) !== null) {
    const fromTable = cleanIdent(m[1]!);
    const fromColumn = cleanIdent(m[2]!);
    const toTable = cleanIdent(m[3]!);
    const toColumn = cleanIdent(m[4]!);
    const col = tables
      .find((t) => t.name === fromTable)
      ?.columns.find((c) => c.name === fromColumn);
    if (col) col.fk = true;
    relations.push({ fromTable, fromColumn, toTable, toColumn });
  }
  return schemaToMermaidEr({ tables, relations });
}

/** Build Mermaid ER from SQL DDL or DBML source. */
export function schemaSourceToMermaidEr(code: string): string {
  const t = code.trim();
  if (/^(table|enum|ref|project)\b/im.test(t) && !looksLikeSqlSchema(t)) {
    return dbmlToMermaidEr(t);
  }
  return sqlToMermaidEr(t);
}
