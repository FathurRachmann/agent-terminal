import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureSvgXmlns,
  fullHdExportScale,
  parseSvgRasterSize,
  prepareSvgForRaster,
} from "./renderer/clipboard.js";

describe("ensureSvgXmlns", () => {
  it("adds xmlns when missing", () => {
    const out = ensureSvgXmlns('<svg width="10"><rect/></svg>');
    assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it("leaves existing xmlns alone", () => {
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect/></svg>';
    assert.equal(ensureSvgXmlns(src), src);
  });
});

describe("parseSvgRasterSize", () => {
  it("reads Mermaid-style viewBox over width=100%", () => {
    const svg =
      '<svg width="100%" style="max-width: 1240.5px; height: auto;" viewBox="0 0 1240.5 880" xmlns="http://www.w3.org/2000/svg"></svg>';
    assert.deepEqual(parseSvgRasterSize(svg), {
      width: 1240.5,
      height: 880,
    });
  });

  it("falls back to absolute width/height attrs", () => {
    assert.deepEqual(
      parseSvgRasterSize('<svg width="400px" height="200"></svg>'),
      { width: 400, height: 200 },
    );
  });
});

describe("prepareSvgForRaster", () => {
  it("forces absolute width/height from viewBox", () => {
    const { svg, width, height } = prepareSvgForRaster(
      '<svg width="100%" style="max-width: 900px" viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
    assert.equal(width, 900);
    assert.equal(height, 500);
    assert.match(svg, /width="900"/);
    assert.match(svg, /height="500"/);
    assert.doesNotMatch(svg, /width="100%"/);
    assert.doesNotMatch(svg, /max-width/);
  });
});

describe("fullHdExportScale", () => {
  it("upsamples small diagrams to Full HD long edge", () => {
    assert.equal(fullHdExportScale(480, 270), 1920 / 480);
  });

  it("keeps at least 2x for already-large diagrams", () => {
    assert.equal(fullHdExportScale(2000, 1000), 2);
  });
});
