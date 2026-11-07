#!/usr/bin/env python3
"""Generate docs/report.docx — the Blurry Photo Cleaner student report in the
five-part documentation format (title page, introduction, how it works,
testing, conclusion). Mirrors docs/report.html; images are the dark-theme
screenshots + the Figure 1 system flow. Run: python docs/generate-report-docx.py
"""
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from pathlib import Path

DOCS = Path(__file__).resolve().parent
ASSETS = DOCS / "assets"

doc = Document()

# --- Page + base styles (readable 12 pt body, clear headings) --------------
for section in doc.sections:
    section.page_width = Inches(8.27)   # A4
    section.page_height = Inches(11.69)
    section.left_margin = section.right_margin = Inches(1.0)
    section.top_margin = section.bottom_margin = Inches(0.9)

normal = doc.styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(12)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")

for name, size, color in [("Heading 1", 18, "1F1F1F"), ("Heading 2", 14, "1F1F1F")]:
    st = doc.styles[name]
    st.font.name = "Calibri"
    st.font.size = Pt(size)
    st.font.color.rgb = RGBColor.from_string(color)
    st.font.bold = True


def caption(text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = True
    run.font.size = Pt(10)
    run.font.color.rgb = RGBColor.from_string("6E6E73")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def picture(path, width_in):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Inches(width_in))


def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


# ===========================================================================
# 1. TITLE PAGE
# ===========================================================================
doc.add_paragraph()
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title.add_run("Blurry Photo Cleaner")
run.font.size = Pt(30)
run.font.bold = True

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = sub.add_run("Find the blurry photos, keep the good ones")
run.font.size = Pt(14)
run.font.color.rgb = RGBColor.from_string("6E6E73")

doc.add_paragraph()
info = doc.add_table(rows=4, cols=2)
info.style = "Table Grid"
info.alignment = WD_TABLE_ALIGNMENT.CENTER
rows = [
    ("Project name", "Blurry Photo Cleaner"),
    ("Your name", "[Your name]"),
    ("Course", "Multimedia"),
    ("Date", "November 7, 2026"),
]
for i, (k, v) in enumerate(rows):
    c0, c1 = info.rows[i].cells
    c0.text = k
    c1.text = v
    shade(c0, "F2F2F2")
    for cell in (c0, c1):
        for par in cell.paragraphs:
            for r in par.runs:
                r.font.size = Pt(12)

doc.add_page_break()

# ===========================================================================
# 2. INTRODUCTION
# ===========================================================================
doc.add_heading("2. Introduction", level=1)
intro = doc.add_paragraph()
run = intro.add_run(
    "Blurry Photo Cleaner helps phone users to find and remove blurry photos "
    "to free up storage every day."
)
run.bold = True

doc.add_paragraph(
    "Problem: phone galleries fill up with near-duplicate and blurry shots, "
    "and finding them by eye means scrolling and zooming through hundreds of "
    "photos — slow, tiring, and easy to get wrong."
)
doc.add_paragraph(
    "Who it helps: anyone whose phone storage is full of photos they took in "
    "a hurry — parents, students, travelers — anyone who wants to keep the "
    "good shots and delete the ruined ones."
)
doc.add_paragraph(
    "Goal: the app scores every selected photo's sharpness inside the "
    "browser, groups the photos into Blurry, Needs review, and Sharp, lets "
    "the user improve and re-save the blurry ones as HD copies, and makes "
    "deleting the bad shots a one-tap, confirmed decision. Photos never "
    "leave the device."
)

# ===========================================================================
# 3. HOW IT WORKS
# ===========================================================================
doc.add_heading("3. How It Works", level=1)
doc.add_paragraph(
    "The app is a single web page that runs entirely in the browser — there "
    "is no server and no account. Photos are chosen, scored, and reviewed on "
    "the device."
)

ipo = doc.add_table(rows=2, cols=3)
ipo.style = "Table Grid"
hdr = [
    "Input (what goes in)",
    "Process (what happens inside)",
    "Output (what comes out)",
]
for i, h in enumerate(hdr):
    ipo.rows[0].cells[i].text = h
    shade(ipo.rows[0].cells[i], "F2F2F2")
    for par in ipo.rows[0].cells[i].paragraphs:
        for r in par.runs:
            r.font.bold = True

ipo.rows[1].cells[0].text = (
    "Selected photo files — picked with the file picker, dragged onto the "
    "page, or chosen from a folder (when the browser supports it). The files "
    "stay on the device."
)
ipo.rows[1].cells[1].text = (
    "Each photo is analyzed in a background Web Worker: decode upright, "
    "downscale to a 256-pixel working image, convert to grayscale, measure "
    "Laplacian variance (edge energy), and normalize to a 0–100 sharpness "
    "score, cut into three bands — under 40 Blurry, 40–59 Needs review, 60+ "
    "Sharp — shown as “NN% sharp” on every tile. Blurry photos are marked "
    "Suggested for deletion. On request, a pool of workers resamples photos "
    "larger, optionally sharpens them, and encodes PNG, JPEG, or WebP — the "
    "result is previewed first, and a downloaded copy is scored fresh and "
    "joins the review at the band it belongs to. Batches convert in "
    "parallel (25 photos in about 9 seconds in testing)."
)
ipo.rows[1].cells[2].text = (
    "A review grid grouped into the three bands, with counts and an “NN% "
    "sharp” chip on every tile. One tap selects the keepers (Sharp plus the "
    "ticked Needs-review photos). Downloads ask for a format (Original, PNG, "
    "JPEG, WebP); HD copies are previewed before saving and re-scored on "
    "download. Photos are removed from the review session after a "
    "confirmation dialog — then deleted on the phone in the gallery app."
)

picture(ASSETS / "figure1-system-flow.png", 6.2)
caption("Figure 1. System flow")

doc.add_heading("The screens", level=2)
shots = [
    ("screenshot-1-empty.png", "Figure 2. Empty upload screen. Photos never leave the device."),
    ("screenshot-2-analyzing.png", "Figure 3. Analyzing photos: progress card over the pending grid (phone view)."),
    ("screenshot-3-results.png", "Figure 4. Results grouped into bands, with an “NN% sharp” chip on every tile and a Suggested mark on the blurry ones."),
    ("screenshot-4-hd-converter.png", "Figure 5. The HD converter: choose a size, a sharpening level, and a format; preview the result before saving."),
    ("screenshot-5-export-formats.png", "Figure 6. Every download asks for its format: Original, PNG, JPEG, or WebP."),
]
for name, cap in shots:
    path = ASSETS / name
    if path.exists():
        picture(path, 5.6 if "analyzing" not in name else 3.0)
        caption(cap)

doc.add_page_break()

# ===========================================================================
# 4. TESTING
# ===========================================================================
doc.add_heading("4. Testing", level=1)
doc.add_paragraph(
    "Tests 1–4 check the features of the app. Test 5 compares it with the old "
    "manual way of doing the same task. Everything was run against the "
    "finished app in automated browser sessions."
)

t = doc.add_table(rows=1, cols=5)
t.style = "Table Grid"
cols = ["Test", "What you tried", "Expected result", "Actual result", "Pass or Fail"]
for i, c in enumerate(cols):
    t.rows[0].cells[i].text = c
    shade(t.rows[0].cells[i], "F2F2F2")
    for par in t.rows[0].cells[i].paragraphs:
        for r in par.runs:
            r.font.bold = True

tests = [
    (
        "Test 1\nUpload",
        "Picked 1 photo, then 24 photos at once; added a plain .txt file and a fake .heic photo; dragged 2 files onto the page.",
        "Every photo appears as a thumbnail with its name; invalid files are counted in a visible notice and never dropped silently.",
        "All 24 thumbnails rendered with the count “24 photos”; the .txt gave “1 file couldn't be opened” with the name listed; the .heic showed the same notice plus a convert-to-JPEG hint; the drag-drop added 2 photos.",
        "Pass",
    ),
    (
        "Test 2\nBlur detection and scores",
        "Scored 2 sharp test patterns and 2 deliberately blurred copies; re-ran the same 4 files; read the score chips.",
        "Sharp patterns score high and land in Sharp; blurred copies score low and land in Blurry; the same file always gets the same score; every tile shows its score as a percentage.",
        "Sharp checkerboard 100 → Sharp, sharp text 96 → Sharp, blurred checkerboard 34 → Blurry, blurred text 36 → Blurry; every re-run gave identical scores; the chips read “100% sharp” … “34% sharp” and matched the stored scores exactly.",
        "Pass",
    ),
    (
        "Test 3\nGrouping, review, and delete",
        "Reviewed batches for band order, counts, the Suggested marks, “Select all recommended”, tapping tiles to select, and deleting through the confirmation dialog (Cancel first, then Delete).",
        "Photos are grouped Blurry → Needs review → Sharp with counts matching the tiles; blurry photos carry a Suggested mark and one tap selects all of them; every removal asks for confirmation first, names the exact count, and Cancel changes nothing.",
        "Bands rendered in order with counts equal to the tiles; the empty middle band showed “No photos in this band”; Cancel and Escape closed the dialog with nothing deleted; confirming removed exactly the named photos and announced the removal; the last removal returned the app to the upload screen.",
        "Pass",
    ),
    (
        "Test 4\nDownload formats, HD copies, and improvement",
        "Pressed Download selected with nothing selected; downloaded with each format (Original, PNG, JPEG, WebP); opened a blurry photo, set sharpening High and 2×, created a preview, downloaded the copy; converted a 25-photo batch in parallel; pressed “Select keepers” and downloaded exactly those.",
        "0 selected disables the button; Original saves the file exactly as it is; the other formats re-encode at the same pixel size; the HD preview appears before anything is saved; a downloaded copy is scored fresh and lands in the band it belongs to; 25 photos convert in one parallel pass; keepers save only Sharp + ticked Needs-review photos.",
        "With 0 selected the button was disabled; Original downloads stayed byte-identical; the JPEG re-export decoded as a real JPEG named photo.jpg. The sharpened HD copy previewed first, then downloaded and entered the review at 54% sharp — Needs review while its 36% Blurry original stayed untouched: the auto-reband worked. All 25 of 25 batch copies downloaded in 9.2 s. “Select keepers” selected exactly the 2 Sharp photos and dropped the manually ticked blurry one.",
        "Pass",
    ),
    (
        "Test 5\nComparison",
        "Same task done with the app and with the manual way — scrolling the phone's gallery and judging each photo by eye.",
        "The app is faster, takes fewer steps, and makes fewer mistakes than judging photos by eye.",
        "App (measured): 20 photos analyzed in 2.6 s while the page stayed responsive; a full run — load 24 photos, review, select 2, download — finished in well under a minute, most of it loading files into the test browser. Manual way (estimate, not measured): scrolling and eyeballing 24 photos takes roughly 3–5 minutes with dozens of scroll-and-judge steps and no score to check the judgment against, so mistakes are likely. The app keeps borderline photos in Needs review instead of guessing for the user.",
        "Pass",
    ),
]
for row in tests:
    cells = t.add_row().cells
    for i, val in enumerate(row):
        cells[i].text = val
        for par in cells[i].paragraphs:
            for r in par.runs:
                r.font.size = Pt(10)

note = doc.add_paragraph()
run = note.add_run(
    "Sources for the measured numbers (automated end-to-end runs in the "
    "project repository): Test 1 — phase2-e2e-matrix (12/12); Test 2 — "
    "phase3-e2e-tester (8/8); Test 3 — phase4-e2e-tester (11/11); Test 4 — "
    "the v0.3.0 features suite (keepers, preview, auto-reband 36→54, JPEG "
    "check, 25-photo batch in 9.2 s); Test 5 (app side) — 20-photo analysis "
    "window 2.61 s. The manual-way time is an estimate, not a measurement. "
    "The app never deletes files from the phone: it removes photos from the "
    "review session after confirmation and saves the copies to keep, so the "
    "files to delete can be found by name in the gallery app."
)
run.font.size = Pt(9)
run.font.color.rgb = RGBColor.from_string("6E6E73")

doc.add_page_break()

# ===========================================================================
# 5. CONCLUSION
# ===========================================================================
doc.add_heading("5. Conclusion", level=1)
conclusion = [
    (
        "What works:",
        " uploading 1 to 24+ photos with invalid and oversized files counted "
        "in a notice instead of dropped silently; sharpness scoring in a "
        "background worker that kept the page responsive (20 photos in "
        "2.6 s); the three-band grouping with an “NN% sharp” percentage on "
        "every tile and Suggested marks on the blurry ones; one-tap Select "
        "keepers; downloads that save the original files byte-identical or "
        "re-encode them as PNG, JPEG, or WebP on request; HD copies at a "
        "chosen size with a sharpening pass, an animated old-to-new "
        "resolution readout, and a preview you approve before anything is "
        "saved; a downloaded copy that is scored fresh and automatically "
        "joins the band it earns (tested: a 36% Blurry original improved to "
        "a 54% Needs-review copy); 25-photo batches converted in parallel in "
        "about 9 seconds; deletion behind a confirmation dialog that names "
        "the exact count; and the privacy promise — photos never leave the "
        "device, verified by running the whole flow with all outside network "
        "requests blocked.",
    ),
    (
        "What does not work:",
        " the app cannot delete photos from the phone — it removes them from "
        "the review session only, and the user deletes those files in the "
        "gallery app themselves. Sharpening adds crispness, not captured "
        "detail: a genuinely unsharp photo stays limited, and the honest fix "
        "is a better photo, not a bigger number. iPhone HEIC photos may need "
        "converting to JPEG first, because some browsers cannot decode them. "
        "And a single sharpness metric can flag sharp-but-low-texture photos "
        "(a sky, a plain wall) as blurry — the Needs review band catches the "
        "borderline cases so the user decides, but those photos still need a "
        "human eye.",
    ),
    (
        "What I would improve:",
        " export all selected photos as one ZIP file instead of one download "
        "at a time; add adjustable thresholds for advanced users; add a real "
        "detail-enhancing upscale model instead of resampling plus "
        "sharpening; and make the app installable and fully offline as a PWA.",
    ),
]
for label, body in conclusion:
    p = doc.add_paragraph(style="List Bullet")
    run = p.add_run(label)
    run.bold = True
    p.add_run(body)

out = DOCS / "report.docx"
doc.save(str(out))
print(f"Wrote {out} ({out.stat().st_size} bytes)")
