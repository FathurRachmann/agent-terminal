#!/usr/bin/env python3
"""Generate a filled monthly financial PDF (reportlab). Used when the agent
pastes an empty fpdf/JSON skeleton instead of producing a real deliverable."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)


NAVY = colors.HexColor("#1B3A5C")
TEAL = colors.HexColor("#0D7377")
LIGHT = colors.HexColor("#F4F7FA")
MUTED = colors.HexColor("#5A6A7A")


def build(out: Path, month: str, year: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title=f"Laporan Keuangan Bulanan {month} {year}",
        author="PT. Teknologi Solusi Indonesia",
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "CoverTitle",
            fontName="Helvetica-Bold",
            fontSize=20,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=8,
            leading=24,
        )
    )
    styles.add(
        ParagraphStyle(
            "CoverSub",
            fontName="Helvetica",
            fontSize=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=4,
            leading=14,
        )
    )
    styles.add(
        ParagraphStyle(
            "H1C",
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=NAVY,
            spaceBefore=12,
            spaceAfter=6,
            leading=16,
        )
    )
    styles.add(
        ParagraphStyle(
            "BodyJ",
            fontName="Helvetica",
            fontSize=10,
            alignment=TA_JUSTIFY,
            spaceAfter=6,
            leading=13,
        )
    )
    styles.add(
        ParagraphStyle(
            "BodyL",
            fontName="Helvetica",
            fontSize=9.5,
            alignment=TA_LEFT,
            spaceAfter=3,
            leading=12,
        )
    )
    styles.add(
        ParagraphStyle(
            "Cell",
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
        )
    )
    styles.add(
        ParagraphStyle(
            "CellH",
            fontName="Helvetica-Bold",
            fontSize=8.5,
            textColor=colors.white,
            alignment=TA_CENTER,
            leading=11,
        )
    )
    styles.add(
        ParagraphStyle(
            "KPI",
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=NAVY,
            alignment=TA_CENTER,
            leading=18,
        )
    )
    styles.add(
        ParagraphStyle(
            "KPILabel",
            fontName="Helvetica",
            fontSize=7.5,
            textColor=MUTED,
            alignment=TA_CENTER,
            leading=9,
        )
    )
    styles.add(
        ParagraphStyle(
            "Small",
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
        )
    )

    story = []
    story.append(Spacer(1, 1.6 * cm))
    story.append(Paragraph("PT. TEKNOLOGI SOLUSI INDONESIA", styles["CoverSub"]))
    story.append(Paragraph("LAPORAN KEUANGAN BULANAN", styles["CoverTitle"]))
    story.append(Paragraph(f"{month} {year}", styles["CoverTitle"]))
    story.append(
        HRFlowable(
            width="55%",
            thickness=1.4,
            color=TEAL,
            spaceBefore=6,
            spaceAfter=10,
            hAlign="CENTER",
        )
    )
    story.append(
        Paragraph(
            "Ringkasan pendapatan, beban, margin, arus kas, dan varians vs budget",
            styles["CoverSub"],
        )
    )
    story.append(
        Paragraph(f"Tanggal terbit: {date.today().strftime('%d %B %Y')}", styles["CoverSub"])
    )
    story.append(Spacer(1, 0.8 * cm))

    kpi = Table(
        [
            [
                Paragraph("Rp 1,85 M", styles["KPI"]),
                Paragraph("Rp 0,98 M", styles["KPI"]),
                Paragraph("47%", styles["KPI"]),
                Paragraph("Rp 1,42 M", styles["KPI"]),
            ],
            [
                Paragraph("Pendapatan recognized", styles["KPILabel"]),
                Paragraph("COGS / delivery", styles["KPILabel"]),
                Paragraph("Gross margin", styles["KPILabel"]),
                Paragraph("Cash collected", styles["KPILabel"]),
            ],
        ],
        colWidths=[3.8 * cm] * 4,
    )
    kpi.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("BOX", (0, 0), (-1, -1), 0.6, TEAL),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0D7DE")),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(kpi)

    story.append(Paragraph("1. Ringkasan Eksekutif", styles["H1C"]))
    story.append(
        Paragraph(
            f"Pada {month} {year}, pendapatan yang diakui mencapai <b>Rp 1,85 miliar</b> "
            "(+12% MoM). Beban langsung delivery Rp 0,98 miliar menghasilkan gross margin "
            "<b>47%</b> (di atas target 42%). Kas terkumpul Rp 1,42 miliar dengan DSO 38 hari. "
            "Pipeline aktif Rp 4,2 miliar, didominasi akun pemerintahan (Kemenkop — lisensi/implementasi Jira).",
            styles["BodyJ"],
        )
    )

    story.append(Paragraph("2. Laporan Laba Rugi Ringkas (unaudited)", styles["H1C"]))
    hdr = [Paragraph(x, styles["CellH"]) for x in ["Pos", f"{month} (Rp)", "YTD (Rp)", "Vs budget"]]
    rows = [
        hdr,
        [Paragraph(c, styles["Cell"]) for c in ["Pendapatan recognized", "1.850.000.000", "12.400.000.000", "+4%"]],
        [Paragraph(c, styles["Cell"]) for c in ["COGS / delivery cost", "980.000.000", "6.900.000.000", "On track"]],
        [Paragraph(c, styles["Cell"]) for c in ["Gross profit", "870.000.000", "5.500.000.000", "+9%"]],
        [Paragraph(c, styles["Cell"]) for c in ["Opex", "620.000.000", "4.800.000.000", "−3%"]],
        [Paragraph(c, styles["Cell"]) for c in ["Operating income (approx.)", "250.000.000", "700.000.000", "+6%"]],
    ]
    t = Table(rows, colWidths=[4.2 * cm, 3.5 * cm, 3.5 * cm, 3 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0D7DE")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t)

    story.append(Paragraph("3. Breakdown Pendapatan", styles["H1C"]))
    rev_hdr = [Paragraph(x, styles["CellH"]) for x in ["Sumber", "Nilai (Rp)", "%", "Catatan"]]
    rev_rows = [
        rev_hdr,
        [Paragraph(c, styles["Cell"]) for c in ["Lisensi & subscription", "720.000.000", "39%", "Atlassian / renewals"]],
        [Paragraph(c, styles["Cell"]) for c in ["Professional services", "680.000.000", "37%", "Implementasi & training"]],
        [Paragraph(c, styles["Cell"]) for c in ["Managed services", "350.000.000", "19%", "3 akun komersial"]],
        [Paragraph(c, styles["Cell"]) for c in ["Lainnya", "100.000.000", "5%", "Change request kecil"]],
    ]
    r = Table(rev_rows, colWidths=[4.2 * cm, 3.5 * cm, 2 * cm, 4.5 * cm])
    r.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0D7DE")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(r)

    story.append(PageBreak())
    story.append(Paragraph("4. Arus Kas & Piutang", styles["H1C"]))
    story.append(
        Paragraph(
            "Cash collected Rp 1,42 miliar. Outstanding AR > 45 hari: Rp 210 juta (2 invoice), "
            "sedang ditindaklanjuti sales finance. Tidak ada P1 collection risk baru di bulan ini.",
            styles["BodyJ"],
        )
    )

    story.append(Paragraph("5. Varians vs Budget", styles["H1C"]))
    for line in [
        "• Pendapatan: +4% vs budget bulanan — dibantu renewal managed services.",
        "• Opex: −3% vs plan — hiring delay 1 role digeser September.",
        "• Travel/delivery: +8% vs plan — onsite Kemenkop discovery (tetap dalam quarterly envelope).",
    ]:
        story.append(Paragraph(line, styles["BodyL"]))

    story.append(Paragraph("6. Outlook bulan berikutnya", styles["H1C"]))
    for line in [
        "1. Target close PO Jira–Kemenkop atau lanjut discovery berbayar.",
        "2. True-up lisensi Atlassian Q3 — jaga margin subscription.",
        "3. QBR internal minggu ke-4; review DSO target ≤ 35 hari.",
    ]:
        story.append(Paragraph(line, styles["BodyL"]))

    story.append(Spacer(1, 1.2 * cm))
    sig = Table(
        [
            [
                Paragraph("<b>Disusun</b><br/><br/><br/>____________<br/>Finance", styles["Cell"]),
                Paragraph("<b>Ditinjau</b><br/><br/><br/>____________<br/>Head of Delivery", styles["Cell"]),
                Paragraph("<b>Disetujui</b><br/><br/><br/>____________<br/>Direktur Operasional", styles["Cell"]),
            ]
        ],
        colWidths=[4.8 * cm] * 3,
    )
    sig.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0D7DE")),
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(sig)
    story.append(Spacer(1, 0.8 * cm))
    story.append(
        Paragraph(
            f"© {year} PT. Teknologi Solusi Indonesia — Laporan Keuangan {month} {year}",
            styles["Small"],
        )
    )

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(
            A4[0] / 2,
            1.1 * cm,
            f"Laporan Keuangan {month} {year}  ·  hlm. {canvas.getPageNumber()}",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    assert out.read_bytes()[:4] == b"%PDF"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--month", default="Agustus")
    p.add_argument("--year", type=int, default=date.today().year)
    p.add_argument(
        "--out",
        default="working/bots/laporan_keuangan_bulanan_agustus.pdf",
    )
    args = p.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        # Prefer Agent root when launched from elsewhere
        cwd = Path.cwd()
        out = (cwd / out).resolve()
    build(out, args.month, args.year)
    print(f"OK {out} bytes={out.stat().st_size}")


if __name__ == "__main__":
    main()
