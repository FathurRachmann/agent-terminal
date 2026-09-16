import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAYOUT_DEFAULTS,
  applyLayoutTemplate,
  normalizeLayoutPrefs,
} from "./layout-prefs.js";

describe("applyLayoutTemplate", () => {
  it("maps Default / Focus / Terminal deck / Quad", () => {
    const base = { ...LAYOUT_DEFAULTS };

    const def = applyLayoutTemplate(base, "default");
    assert.equal(def.railOpen, true);
    assert.equal(def.terminalOpen, false);
    assert.equal(def.templateId, "default");

    const focus = applyLayoutTemplate(base, "focus");
    assert.equal(focus.railOpen, false);
    assert.equal(focus.terminalOpen, false);
    assert.equal(focus.templateId, "focus");

    const deck = applyLayoutTemplate(base, "terminal-deck");
    assert.equal(deck.railOpen, false);
    assert.equal(deck.terminalOpen, true);
    assert.equal(deck.templateId, "terminal-deck");

    const quad = applyLayoutTemplate(base, "quad");
    assert.equal(quad.railOpen, true);
    assert.equal(quad.terminalOpen, true);
    assert.equal(quad.templateId, "quad");
  });

  it("preserves widths when applying templates", () => {
    const next = applyLayoutTemplate(
      { ...LAYOUT_DEFAULTS, sidebarWidth: 300, railWidth: 450 },
      "focus",
    );
    assert.equal(next.sidebarWidth, 300);
    assert.equal(next.railWidth, 450);
  });
});

describe("normalizeLayoutPrefs", () => {
  it("fills defaults for legacy saves without template fields", () => {
    const n = normalizeLayoutPrefs({
      sidebarWidth: 260,
      railWidth: 360,
      sidebarOpen: true,
      railOpen: true,
      swapped: false,
    });
    assert.equal(n.templateId, "default");
    assert.equal(n.terminalOpen, false);
    assert.equal(n.sidebarWidth, 260);
  });

  it("infers terminal-deck from legacy terminalOpen", () => {
    const n = normalizeLayoutPrefs({
      sidebarOpen: true,
      railOpen: false,
      terminalOpen: true,
      terminalHeight: 200,
    });
    assert.equal(n.templateId, "terminal-deck");
  });
});
