#!/usr/bin/env python3
"""Create a PDF from a JSON spec using reportlab platypus.

Spec format (UTF-8 JSON):
{
  "title": "Example Report",
  "author": "example-author",
  "page_size": "A4",            // or "letter" (default: A4)
  "page_numbers": true,          // default true
  "elements": [
    {"type": "heading", "text": "Section 1", "level": 1},
    {"type": "paragraph", "text": "Body text..."},
    {"type": "table", "rows": [["H1", "H2"], ["a", "b"]], "header": true},
    {"type": "image", "path": "chart.png", "width": 400},
    {"type": "mermaid", "code": "flowchart TD; A-->B", "width": 480},
    {"type": "pagebreak"}
  ]
}

Hard rules:
- NEVER put Mermaid source as a paragraph. Use type "mermaid" (renders to PNG)
  or type "image" with a pre-rendered diagram PNG.
- Tables always get black 0.5pt borders (visible grid lines).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def _reconfigure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _find_agent_root() -> Path | None:
    """Walk up from cwd / this script for a package.json that lists playwright."""
    candidates = [Path.cwd().resolve(), Path(__file__).resolve().parent]
    for start in candidates:
        cur = start
        for _ in range(10):
            pkg = cur / "package.json"
            if pkg.is_file():
                try:
                    data = json.loads(pkg.read_text(encoding="utf-8"))
                except Exception:
                    data = {}
                deps = {
                    **(data.get("dependencies") or {}),
                    **(data.get("devDependencies") or {}),
                }
                if "playwright" in deps or (cur / "node_modules" / "playwright").exists():
                    return cur
            parent = cur.parent
            if parent == cur:
                break
            cur = parent
    return None


def render_mermaid_to_png(code: str, out_png: Path) -> None:
    """Render Mermaid → PNG via sibling mermaid_to_png.mjs + Playwright."""
    script = Path(__file__).resolve().parent / "mermaid_to_png.mjs"
    if not script.is_file():
        raise RuntimeError(f"Missing renderer script: {script}")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    root = _find_agent_root()
    env = dict(os.environ)
    cmd = [
        "node",
        str(script),
        "--code",
        code,
        "--output",
        str(out_png),
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(root) if root else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            "Mermaid render failed — do not paste Mermaid source into the PDF. "
            f"Details: {detail or f'exit {proc.returncode}'}"
        )


def _table_style(header: bool, colors):
    """Black 0.5pt grid — visible strokes for print/PDF viewers."""
    style = [
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.92, 0.92, 0.92)),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ]
    return style


def build_pdf(spec: dict, out_path: str) -> int:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            Image,
            PageBreak,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError:
        print(
            "Missing dependency: install with 'python3 -m pip install reportlab'",
            file=sys.stderr,
        )
        return 2

    page_size = letter if str(spec.get("page_size", "A4")).lower() == "letter" else A4
    styles = getSampleStyleSheet()
    story = []
    temp_dir = Path(tempfile.mkdtemp(prefix="pdf-mermaid-"))
    mermaid_idx = 0

    try:
        for el in spec.get("elements", []):
            etype = el.get("type")
            if etype == "heading":
                level = min(max(int(el.get("level", 1)), 1), 3)
                story.append(Paragraph(el.get("text", ""), styles[f"Heading{level}"]))
            elif etype == "paragraph":
                story.append(Paragraph(el.get("text", ""), styles["BodyText"]))
                story.append(Spacer(1, 6))
            elif etype == "table":
                rows = el.get("rows", [])
                if not rows:
                    continue
                table = Table(rows, repeatRows=1 if el.get("header", True) else 0)
                table.setStyle(
                    TableStyle(_table_style(bool(el.get("header", True)), colors))
                )
                story.append(table)
                story.append(Spacer(1, 10))
            elif etype in ("image", "mermaid"):
                img_path = el.get("path")
                if etype == "mermaid":
                    code = str(el.get("code") or el.get("text") or "").strip()
                    if not code and img_path and Path(str(img_path)).is_file():
                        code = Path(str(img_path)).read_text(encoding="utf-8")
                    if not code:
                        print(
                            "Warning: mermaid element missing code, skipped",
                            file=sys.stderr,
                        )
                        continue
                    mermaid_idx += 1
                    img_path = temp_dir / f"diagram-{mermaid_idx}.png"
                    try:
                        render_mermaid_to_png(code, Path(img_path))
                    except RuntimeError as exc:
                        print(f"Error: {exc}", file=sys.stderr)
                        return 1
                if not img_path:
                    print("Warning: image element missing path, skipped", file=sys.stderr)
                    continue
                kwargs = {}
                if el.get("width"):
                    kwargs["width"] = float(el["width"])
                if el.get("height"):
                    kwargs["height"] = float(el["height"])
                img = Image(str(img_path), **kwargs)
                if "width" in kwargs and "height" not in kwargs:
                    ratio = img.imageHeight / img.imageWidth
                    img.drawWidth = kwargs["width"]
                    img.drawHeight = kwargs["width"] * ratio
                elif "width" not in kwargs:
                    # Fit readable width on A4 content area (~450pt)
                    max_w = float(el.get("max_width", 480))
                    if img.imageWidth > max_w:
                        ratio = img.imageHeight / img.imageWidth
                        img.drawWidth = max_w
                        img.drawHeight = max_w * ratio
                story.append(img)
                caption = el.get("caption")
                if caption:
                    story.append(Spacer(1, 4))
                    story.append(Paragraph(str(caption), styles["Italic"]))
                story.append(Spacer(1, 10))
            elif etype == "pagebreak":
                story.append(PageBreak())
            else:
                print(
                    f"Warning: unknown element type {etype!r}, skipped",
                    file=sys.stderr,
                )

        def draw_page_number(canvas, doc):
            if spec.get("page_numbers", True):
                canvas.saveState()
                canvas.setFont("Helvetica", 9)
                canvas.drawCentredString(
                    page_size[0] / 2.0, 0.5 * inch, f"Page {doc.page}"
                )
                canvas.restoreState()

        doc = SimpleDocTemplate(
            out_path,
            pagesize=page_size,
            title=spec.get("title", ""),
            author=spec.get("author", ""),
        )
        doc.build(story, onFirstPage=draw_page_number, onLaterPages=draw_page_number)
        print(
            json.dumps(
                {"output": out_path, "elements": len(spec.get("elements", []))}
            )
        )
        return 0
    finally:
        # Best-effort cleanup of temp Mermaid PNGs
        try:
            for p in temp_dir.glob("*"):
                p.unlink(missing_ok=True)
            temp_dir.rmdir()
        except Exception:
            pass


def main() -> int:
    _reconfigure_stdio()
    parser = argparse.ArgumentParser(
        description="Create a PDF from a JSON spec (reportlab)."
    )
    parser.add_argument("spec", help="Path to UTF-8 JSON spec file")
    parser.add_argument("-o", "--output", required=True, help="Output PDF path")
    args = parser.parse_args()
    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    return build_pdf(spec, args.output)


if __name__ == "__main__":
    sys.exit(main())
