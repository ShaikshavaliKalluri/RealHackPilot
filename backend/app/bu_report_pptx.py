"""Generate a downloadable PPTX of the BU leadership report.

Each slide follows the same visual language as the on-screen presentation
view: brand header, BU title, description, tag rollup, top-3 standout
cards (with AI score + judge synthesis if present), and a long-tail list.

The PPTX ships to senior leadership as a real, editable PowerPoint file.
"""
from __future__ import annotations

import io
from typing import Any

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR


# Brand palette
BRAND_BLUE = RGBColor(0x0A, 0x4F, 0x99)
BRAND_BLUE_LIGHT = RGBColor(0xDC, 0xEA, 0xFD)
BRAND_BLUE_BG = RGBColor(0xF7, 0xFA, 0xFD)
BRAND_TEAL = RGBColor(0x2A, 0xA0, 0x9A)
BRAND_AMBER = RGBColor(0xD4, 0xA0, 0x17)
BRAND_AMBER_BG = RGBColor(0xFF, 0xF8, 0xE0)
BRAND_GREEN = RGBColor(0x2B, 0x7A, 0x2B)
INK_DARK = RGBColor(0x1A, 0x1F, 0x26)
INK_MID = RGBColor(0x33, 0x33, 0x33)
INK_LIGHT = RGBColor(0x5A, 0x6A, 0x7A)
INK_HAIR = RGBColor(0xCA, 0xD9, 0xE8)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


SLIDE_W = Inches(13.333)  # 16:9 widescreen
SLIDE_H = Inches(7.5)
MARGIN_X = Inches(0.6)
CONTENT_W = SLIDE_W - (MARGIN_X * 2)


def _set_run(run, text: str, size_pt: int, bold: bool = False, color: RGBColor = INK_DARK, font: str = "Calibri"):
    run.text = text
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.name = font
    run.font.color.rgb = color


def _add_text_box(slide, left, top, width, height, text: str, *,
                  size_pt: int = 14, bold: bool = False,
                  color: RGBColor = INK_DARK, align=None, anchor=None,
                  font: str = "Calibri"):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Emu(0)
    tf.margin_right = Emu(0)
    tf.margin_top = Emu(0)
    tf.margin_bottom = Emu(0)
    if anchor is not None:
        tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    if align is not None:
        p.alignment = align
    run = p.add_run()
    _set_run(run, text, size_pt, bold=bold, color=color, font=font)
    return tb


def _add_paragraph(text_frame, text: str, *, size_pt: int = 12, bold: bool = False,
                   color: RGBColor = INK_DARK, align=None, space_before_pt: int = 0):
    p = text_frame.add_paragraph()
    if align is not None:
        p.alignment = align
    if space_before_pt:
        p.space_before = Pt(space_before_pt)
    run = p.add_run()
    _set_run(run, text, size_pt, bold=bold, color=color)
    return p


def _add_rect(slide, left, top, width, height, fill_rgb: RGBColor, line_rgb: RGBColor | None = None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_rgb
    if line_rgb is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line_rgb
        shape.line.width = Pt(0.5)
    shape.shadow.inherit = False
    return shape


def _add_brand_header(slide, subtitle: str = ""):
    """Blue band across the top of every non-title slide."""
    _add_rect(slide, 0, 0, SLIDE_W, Inches(0.5), BRAND_BLUE)
    _add_text_box(
        slide, MARGIN_X, Inches(0.08),
        Inches(6), Inches(0.35),
        "RealHack 2026 · Leadership Report",
        size_pt=12, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE,
    )
    if subtitle:
        _add_text_box(
            slide, SLIDE_W - Inches(6) - MARGIN_X, Inches(0.08),
            Inches(6), Inches(0.35),
            subtitle,
            size_pt=11, color=WHITE, align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE,
        )


def _add_title_slide(prs: Presentation, report: dict):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    # Full-bleed dark blue background
    _add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, BRAND_BLUE)
    # Accent bar
    _add_rect(slide, MARGIN_X, Inches(2.6), Inches(0.5), Inches(0.08), WHITE)
    # Superhead
    _add_text_box(
        slide, MARGIN_X, Inches(2.2),
        CONTENT_W, Inches(0.35),
        "RealHack 2026",
        size_pt=14, bold=True, color=WHITE,
    )
    # Title
    _add_text_box(
        slide, MARGIN_X, Inches(2.8),
        CONTENT_W, Inches(1.6),
        "Ideas by Business Unit",
        size_pt=48, bold=True, color=WHITE,
    )
    _add_text_box(
        slide, MARGIN_X, Inches(4.2),
        CONTENT_W, Inches(0.6),
        "A leadership review of every submission, classified into its home BU",
        size_pt=18, color=BRAND_BLUE_LIGHT,
    )
    # Meta at the bottom
    total = report.get("total_teams", 0)
    round_num = report.get("round", 1)
    meta = f"Round {round_num}  ·  {total} ideas submitted  ·  AI-summarized  ·  Judge feedback synthesized"
    _add_text_box(
        slide, MARGIN_X, Inches(6.6),
        CONTENT_W, Inches(0.4),
        meta,
        size_pt=12, color=BRAND_BLUE_LIGHT,
    )


def _add_overview_slide(prs: Presentation, report: dict):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, WHITE)
    _add_brand_header(slide, f"Round {report.get('round', 1)}")
    _add_text_box(
        slide, MARGIN_X, Inches(0.7),
        CONTENT_W, Inches(0.6),
        "How to use this report",
        size_pt=26, bold=True, color=BRAND_BLUE,
    )

    body_tb = slide.shapes.add_textbox(MARGIN_X, Inches(1.4), CONTENT_W, Inches(2.5))
    tf = body_tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    _set_run(r,
        "Every RealHack 2026 idea has been classified into one of six RealPage business "
        "units. For each BU, the report surfaces the top three standout ideas (with a "
        "synthesis of what the judges said) followed by the long tail. If something "
        "looks useful for your area, reach out to the team and consider adopting or "
        "evolving it.",
        13, color=INK_MID,
    )
    _add_paragraph(tf,
        "AI scores are on a 1–10 scale (10 = truly standout: clear customer problem, "
        "feasible in a quarter or two, defensible differentiation). Most ideas land 5–7.",
        size_pt=12, color=INK_LIGHT, space_before_pt=8,
    )

    # BU coverage grid: 7 tiles, 2 rows
    tiles_top = Inches(4.4)
    tile_h = Inches(1.2)
    tile_w = (CONTENT_W - Inches(0.3 * 3)) / 4  # 4 across
    tile_gap = Inches(0.1)
    bus = report.get("bus", [])
    for idx, bu in enumerate(bus[:8]):
        row = idx // 4
        col = idx % 4
        left = MARGIN_X + col * (tile_w + tile_gap)
        top = tiles_top + row * (tile_h + tile_gap)
        _add_rect(slide, left, top, tile_w, tile_h, BRAND_BLUE_BG, INK_HAIR)
        _add_text_box(
            slide, left + Inches(0.15), top + Inches(0.1),
            tile_w - Inches(0.3), Inches(0.4),
            bu.get("display", "?"),
            size_pt=13, bold=True, color=BRAND_BLUE,
        )
        team_count = bu.get("team_count", 0)
        avg = bu.get("avg_ai_score")
        line2 = f"{team_count} idea{'' if team_count == 1 else 's'}"
        if avg is not None:
            line2 += f"  ·  avg AI {avg}/10"
        _add_text_box(
            slide, left + Inches(0.15), top + Inches(0.55),
            tile_w - Inches(0.3), Inches(0.6),
            line2,
            size_pt=11, color=INK_LIGHT,
        )


def _add_bu_section_slide(prs: Presentation, bu: dict):
    """One slide per BU: name, count, description, tag rollup, standout cards."""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, WHITE)
    _add_brand_header(slide, bu.get("display", ""))

    # Title row: BU name (left) + count/avg score (right)
    _add_text_box(
        slide, MARGIN_X, Inches(0.7),
        CONTENT_W - Inches(3), Inches(0.6),
        bu.get("display", "?"),
        size_pt=26, bold=True, color=BRAND_BLUE,
    )
    count = bu.get("team_count", 0)
    avg = bu.get("avg_ai_score")
    meta = f"{count} idea{'' if count == 1 else 's'}"
    if avg is not None:
        meta += f"    ·    avg AI score {avg}/10"
    _add_text_box(
        slide, SLIDE_W - Inches(3.5), Inches(0.85),
        Inches(3), Inches(0.4),
        meta,
        size_pt=12, color=INK_LIGHT, align=PP_ALIGN.RIGHT,
    )

    # Description
    _add_text_box(
        slide, MARGIN_X, Inches(1.35),
        CONTENT_W, Inches(0.7),
        bu.get("description", ""),
        size_pt=11, color=INK_MID,
    )

    # Tag rollup (thin band)
    tag_top = Inches(2.05)
    tag_h = Inches(0.6)
    tag_lines = []
    if bu.get("top_sub_tags"):
        tag_lines.append("Divisions: " + ", ".join(f"{_pretty_tag(t)} ({n})" for t, n in bu["top_sub_tags"]))
    if bu.get("top_theme_tags"):
        tag_lines.append("Themes: " + ", ".join(f"{_pretty_tag(t)} ({n})" for t, n in bu["top_theme_tags"]))
    if tag_lines:
        _add_rect(slide, MARGIN_X, tag_top, CONTENT_W, tag_h, BRAND_BLUE_BG)
        _add_rect(slide, MARGIN_X, tag_top, Inches(0.08), tag_h, BRAND_BLUE)
        tb = slide.shapes.add_textbox(MARGIN_X + Inches(0.2), tag_top + Inches(0.06), CONTENT_W - Inches(0.3), tag_h)
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        r = p.add_run()
        _set_run(r, tag_lines[0], 11, color=INK_MID)
        for extra in tag_lines[1:]:
            _add_paragraph(tf, extra, size_pt=11, color=INK_MID, space_before_pt=1)

    # Standout cards: up to 3 side-by-side
    standouts = bu.get("standouts", [])[:3]
    if standouts:
        cards_top = Inches(2.85)
        cards_bottom = Inches(6.9)
        cards_h = cards_bottom - cards_top
        n = len(standouts)
        gap = Inches(0.15)
        card_w = (CONTENT_W - gap * (n - 1)) / n
        for i, t in enumerate(standouts):
            left = MARGIN_X + i * (card_w + gap)
            _add_standout_card(slide, left, cards_top, card_w, cards_h, t)

    # Long tail: bullet list at the bottom (compact)
    long_tail = bu.get("long_tail", [])
    if long_tail:
        lt_top = Inches(6.95) if standouts else Inches(2.85)
        _add_text_box(
            slide, MARGIN_X, lt_top,
            Inches(3), Inches(0.3),
            f"Also submitted ({len(long_tail)})",
            size_pt=10, bold=True, color=INK_LIGHT,
        )
        # If we have room, add a second slide for the long tail if it's big.
        _add_long_tail_inline(slide, long_tail, MARGIN_X, lt_top + Inches(0.3), max_lines=1)

    # If long tail has more than 1 line's worth, spill onto a follow-up slide
    if len(long_tail) > 3:
        _add_bu_long_tail_slide(prs, bu, long_tail[3:] if len(standouts) > 0 else long_tail)


def _add_standout_card(slide, left, top, width, height, team: dict):
    """A single team card inside a BU slide."""
    # Card body
    _add_rect(slide, left, top, width, height, BRAND_BLUE_BG, INK_HAIR)
    # Left accent bar
    _add_rect(slide, left, top, Inches(0.08), height, BRAND_BLUE)
    inner_l = left + Inches(0.2)
    inner_w = width - Inches(0.3)

    # Team name
    name_tb = _add_text_box(
        slide, inner_l, top + Inches(0.15),
        inner_w - Inches(0.9), Inches(0.5),
        team.get("team_name", "?"),
        size_pt=13, bold=True, color=BRAND_BLUE,
    )
    _ = name_tb

    # AI score badge (top right of card)
    score = team.get("ai_score_10")
    if score is not None:
        _add_text_box(
            slide, left + width - Inches(1.0), top + Inches(0.12),
            Inches(0.85), Inches(0.5),
            f"{score}/10",
            size_pt=18, bold=True, color=BRAND_GREEN, align=PP_ALIGN.RIGHT,
        )

    # Sub-tag chips
    tags = list(team.get("sub_tags") or [])[:3]
    if tags:
        tag_text = "  ·  ".join(_pretty_tag(t) for t in tags)
        _add_text_box(
            slide, inner_l, top + Inches(0.6),
            inner_w, Inches(0.35),
            tag_text,
            size_pt=9, color=BRAND_BLUE,
        )

    # Summary paragraph
    summary_top = top + Inches(1.0)
    summary_h = Inches(1.6)
    if team.get("summary"):
        _add_text_box(
            slide, inner_l, summary_top,
            inner_w, summary_h,
            team["summary"],
            size_pt=10.5, color=INK_MID,
        )

    # Judge synthesis (amber block)
    js_text = (team.get("judge_synthesis") or "").strip()
    if js_text:
        js_top = summary_top + summary_h + Inches(0.1)
        js_h = Inches(1.3)
        _add_rect(slide, inner_l, js_top, inner_w, js_h, BRAND_AMBER_BG)
        _add_rect(slide, inner_l, js_top, Inches(0.06), js_h, BRAND_AMBER)
        tb = slide.shapes.add_textbox(inner_l + Inches(0.12), js_top + Inches(0.05), inner_w - Inches(0.2), js_h)
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        r = p.add_run()
        _set_run(r, "Judges said: ", 9, bold=True, color=RGBColor(0x7A, 0x5C, 0x00))
        r2 = p.add_run()
        _set_run(r2, js_text, 9, color=INK_MID)


def _add_long_tail_inline(slide, teams: list[dict], left, top, max_lines: int = 1):
    """Compact one-line-per-team list at the bottom of the BU slide."""
    box_h = Inches(0.35 * max_lines)
    tb = slide.shapes.add_textbox(left, top, CONTENT_W, box_h)
    tf = tb.text_frame
    tf.word_wrap = True
    text = "  ·  ".join(
        f"{t.get('team_name','?')}" + (f" ({t.get('ai_score_10')}/10)" if t.get('ai_score_10') is not None else "")
        for t in teams[: min(6, len(teams))]
    )
    p = tf.paragraphs[0]
    run = p.add_run()
    _set_run(run, text, 9, color=INK_LIGHT)


def _add_bu_long_tail_slide(prs: Presentation, bu: dict, remaining: list[dict]):
    """Follow-up slide for BUs with more long-tail items than fit on the
    main slide."""
    if not remaining:
        return
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, WHITE)
    _add_brand_header(slide, f"{bu.get('display', '')} (continued)")
    _add_text_box(
        slide, MARGIN_X, Inches(0.7),
        CONTENT_W, Inches(0.5),
        f"{bu.get('display','?')}  ·  also submitted ({len(remaining)})",
        size_pt=20, bold=True, color=BRAND_BLUE,
    )
    # Two-column bullet list
    per_col = (len(remaining) + 1) // 2
    col_w = (CONTENT_W - Inches(0.4)) / 2
    for col_i in range(2):
        items = remaining[col_i * per_col:(col_i + 1) * per_col]
        if not items:
            continue
        col_left = MARGIN_X + col_i * (col_w + Inches(0.4))
        tb = slide.shapes.add_textbox(col_left, Inches(1.4), col_w, Inches(5.8))
        tf = tb.text_frame
        tf.word_wrap = True
        for i, t in enumerate(items):
            title = t.get("team_name", "?")
            score = t.get("ai_score_10")
            score_txt = f" · AI {score}/10" if score is not None else ""
            summary = (t.get("summary") or "").strip()
            if i == 0:
                p = tf.paragraphs[0]
            else:
                p = tf.add_paragraph()
                p.space_before = Pt(6)
            r = p.add_run()
            _set_run(r, f"{title}{score_txt}", 11, bold=True, color=BRAND_BLUE)
            if summary:
                p2 = tf.add_paragraph()
                p2.space_before = Pt(1)
                r2 = p2.add_run()
                _set_run(r2, summary, 10, color=INK_MID)


def _add_closing_slide(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, BRAND_BLUE)
    _add_text_box(
        slide, MARGIN_X, Inches(3.0),
        CONTENT_W, Inches(1.0),
        "Thank you",
        size_pt=44, bold=True, color=WHITE, align=PP_ALIGN.CENTER,
    )
    _add_text_box(
        slide, MARGIN_X, Inches(4.2),
        CONTENT_W, Inches(0.6),
        "Reach out to any team to explore adoption or evolution of these ideas.",
        size_pt=16, color=BRAND_BLUE_LIGHT, align=PP_ALIGN.CENTER,
    )


def _pretty_tag(t: str) -> str:
    return t.replace("_", " ")


def build_pptx(report: dict) -> bytes:
    """Assemble the entire deck and return raw .pptx bytes."""
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    _add_title_slide(prs, report)
    _add_overview_slide(prs, report)

    for bu in report.get("bus", []):
        if bu.get("team_count", 0) == 0:
            continue
        _add_bu_section_slide(prs, bu)

    _add_closing_slide(prs)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
