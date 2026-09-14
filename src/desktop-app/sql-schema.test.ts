import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeSqlSchema,
  parseSqlSchema,
  sqlToDbml,
  sqlToMermaidEr,
} from "../desktop-app/renderer/sql-schema.js";

const SAMPLE = `
-- Tabel User
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    failed_login_attempts INT DEFAULT 0,
    lockout_until TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token_hash VARCHAR(64) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_token ON sessions(session_token_hash);
`;

describe("sql schema diagram", () => {
  it("detects create table schemas", () => {
    assert.equal(looksLikeSqlSchema(SAMPLE), true);
    assert.equal(looksLikeSqlSchema("select 1"), false);
  });

  it("parses tables, pk, and references", () => {
    const model = parseSqlSchema(SAMPLE);
    assert.equal(model.tables.length, 2);
    assert.ok(model.tables.some((t) => t.name === "users"));
    assert.ok(model.tables.some((t) => t.name === "sessions"));
    const users = model.tables.find((t) => t.name === "users")!;
    assert.ok(users.columns.some((c) => c.name === "id" && c.pk));
    assert.ok(
      model.relations.some(
        (r) =>
          r.fromTable === "sessions" &&
          r.fromColumn === "user_id" &&
          r.toTable === "users" &&
          r.toColumn === "id",
      ),
    );
  });

  it("emits mermaid erDiagram and dbml", () => {
    const er = sqlToMermaidEr(SAMPLE);
    assert.match(er, /^erDiagram/m);
    assert.match(er, /users/);
    assert.match(er, /sessions/);
    assert.match(er, /\|\|--o\{/);

    const dbml = sqlToDbml(SAMPLE);
    assert.match(dbml, /Table users/);
    assert.match(dbml, /Table sessions/);
    assert.match(dbml, /Ref: sessions\.user_id > users\.id/);
  });
});
