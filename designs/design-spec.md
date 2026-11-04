# Blurry Photo Cleaner — Design of Record

## 1. Document meta & references

| | |
|---|---|
| Artifact | `designs/design-spec.md` — design of record, Phase 1 of `plans/blurry-photo-cleaner.md` |
| Status | draft for artifact review (Phase 1 check: cheap, artifact review only) |
| Created | 2026-11-04 |
| Owner | designer |
| Scope | Design only. This spec contains no application code; `index.html`, `css/`, `js/` are created by later phases building to this spec. |

### References consulted (fetched 2026-11-04)

- Apple Human Interface Guidelines — **Color**: https://developer.apple.com/design/human-interface-guidelines/color.md — system color values (source of the blue accent and band-color values in §3), semantic-color discipline, inclusive-color rule (never color alone), grouped-background hierarchy.
- Apple Human Interface Guidelines — **Typography**: https://developer.apple.com/design/human-interface-guidelines/typography.md — SF Pro, 17 pt default body, Dynamic Type scale (source of the type scale in §4), tracking table, "avoid light weights", no embedded system fonts.
- Apple Human Interface Guidelines — **Materials**: https://developer.apple.com/design/human-interface-guidelines/materials.md — depth comes from layering with legibility first; effects used sparingly (source of the depth rules in §5).
- Apple Human Interface Guidelines — **Designing for iOS**: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios.md — limit onscreen controls; primary controls in the middle/bottom thumb-reach zone (source of the bottom action bar in §7).
- `ui-reference` skill baseline reject list and `unslop` skill catalog (workspace skills) — the AI-design tells this spec is written to avoid (see §14).

Research note: the `websearch` tool was unavailable this session; the four HIG pages above were fetched directly by URL and are primary, dated sources. Pattern familiarity with Apple Photos / Google Photos review grids comes from training knowledge and is used as context, not cited as evidence.

## 2. Product & design direction

**Product** (one plain sentence): a private, in-browser tool that scores a phone's photo library for sharpness so the user can review the blurry ones and delete those files on the phone to free storage.

**Direction** (the plan's five lines, made concrete):

- **Character** — calm, precise, unhurried. The interface never competes with the photos for attention.
- **World** — the camera roll itself: a light, near-monochrome chrome (iOS grouped-background grays) that disappears behind full-color photo thumbnails. The photos are the richness; the chrome stays quiet.
- **Moments** — exactly two: (1) the photo grid, where real thumbnails carry all the visual weight, and (2) the blue selection moment — the one saturated color on screen, reserved for selection and primary action.
- **Signature** — the band score chip: a small colored dot plus a tabular score number on every tile, repeated identically everywhere, in the band's color. One detail, used consistently, that only this product would have.
- **Restraint rules** — no glows, no gradient text, no colored shadows, no decorative motion, no emoji in the interface, no deletion affordances (the app cannot delete; delete happens on the phone).

**Named styles** (shared vocabulary for spec and implementation):

- *Aesthetic*: Apple system style — iOS grouped-inset surfaces on a `systemGroupedBackground` gray page, system font, one accent.
- *Layout style*: single-column app shell, no sidebar; sticky translucent header; content-width capped on desktop; bottom-anchored action bar in the thumb-reach zone.
- *Interaction style*: direct manipulation on tiles (tap to select), full-screen sheet on mobile / centered modal on desktop for detail review, notices as dismissible inline cards — never modal alerts for recoverable problems.

**Appearance scope**: light appearance is the shipped design of record. All color tokens are named semantically (§3) so a dark theme is a token swap; full dark-mode support is not a v1 requirement in the plan and is not specced beyond that note.

## 3. Design tokens — color

Named values. CSS custom properties in later phases use exactly these names (`--color-*`). All values are light-appearance; see §2 for the dark-theme note.

### 3.1 Surfaces and text

| Token | Value | Role | Contrast on white surface |
|---|---|---|---|
| `--color-bg` | `#F2F2F7` | Page background (iOS grouped-background pattern; HIG gray table, systemGray6 light) | — |
| `--color-surface` | `#FFFFFF` | Cards, tiles' meta area, sheets, modals (systemBackground pattern) | — |
| `--color-surface-muted` | `#F2F2F7` | Inputs, secondary buttons, hover rows *inside* white surfaces | — |
| `--color-fill-pressed` | `#E5E5EA` | Pressed control fill (HIG gray table, systemGray5 light) | — |
| `--color-text` | `#000000` | Primary labels and body text (iOS label, light) | 21:1 |
| `--color-text-secondary` | `#636366` | Supporting text (adapted from the HIG gray table — Gray2 dark value — chosen so it clears 4.5:1 on white) | ≈6.0:1 |
| `--color-text-muted` | `#6E6E73` | Meta and captions only: file sizes, timestamps, empty-grid hints (derived: systemGray `#8E8E93` darkened to clear 4.5:1) | ≈5.1:1 |
| `--color-hairline` | `rgba(0,0,0,0.08)` | Card borders, separators, dividers (the only border treatment in the app) | decorative |
| `--color-separator-strong` | `rgba(0,0,0,0.15)` | Input borders, opaque dividers where a slightly firmer line is needed | decorative |
| `--color-hover-overlay` | `rgba(0,0,0,0.04)` | Desktop hover veil on photo tiles (pointer only) | decorative |

### 3.2 Accent (one accent only)

| Token | Value | Role | Notes |
|---|---|---|---|
| `--color-accent` | `#0088FF` | Non-text accent: selection tint, band-dot alternative uses, focus indicators on dark imagery | systemBlue light per HIG color table (fetched 2026-11-04; values updated 2025-06-09). **Never as text color** — ≈3.5:1 on white fails body-text contrast |
| `--color-accent-strong` | `#1E6EF4` | Primary button fill, links, accent text on white surfaces, focus ring | HIG blue increased-contrast light. White label on it ≈4.6:1 (passes 4.5:1); as text on white ≈4.6:1. **Not for accent text on non-white surfaces** — it measures 4.10:1 on the grouped background and 4.16:1 over the translucent header with content scrolled beneath (Phase 2 UX finding F-1); those uses take `--color-accent-text` |
| `--color-accent-text` | `#0F4CBD` | Accent text on non-white surfaces: header "Start over", gallery-toolbar "Add more", band-header "Select all" (Phase 3) | derived: accent-strong with the same 219° hue, darkened (lightness 54%→40%) so accent text clears 4.5:1 on every surface it renders on — ≈6.7:1 on `#F2F2F7`, ≈7.5:1 on white, and ≥≈5.3:1 on the worst-case header composite (85% white over a near-black photo scrolled beneath) |
| `--color-accent-subtle` | `rgba(0,136,255,0.10)` (effective `#E6F3FF` on white) | Selected-tile tint, drag-over drop-zone fill | decorative; meaning is carried by ring + checkmark, not by tint alone |
| `--color-accent-press` | `#1A63DB` | Primary button pressed fill | derived: accent-strong darkened ≈8% |

Accent-text surface rule (added with Phase 2 fix F-1): accent-colored text on a white card surface uses `--color-accent-strong`; on any non-white surface — the translucent header (`rgba(255,255,255,0.85)`) or the grouped background (`#F2F2F7`) — it uses `--color-accent-text` instead. Both tokens stay in the single 219° accent family (§3.5).

### 3.3 Band colors (semantic; each has a base text value, an on-tint text value, and a tint value)

Sourced from the HIG color table's increased-contrast variants. The base text values clear 4.5:1 **on white only** (≈4.54–4.56:1); the earlier "≈4.5:1" claim did not hold where the values actually render — on the 10% tint over the grouped background they measure 3.49–3.60:1, and on `#F2F2F7` 4.08:1 (Phase 4 UX findings F1/F2). Band text on a tint or the grouped background therefore uses the darker `--color-band-*-text` variants below: same hue and saturation as the base value, lightness reduced until each clears ≥4.5:1 on its worst-case (tinted) composite. Same pattern as `--color-accent-text` (§3.2).

| Token | Base text value (white surfaces) | Tint value (chips, 10% fills) | Meaning |
|---|---|---|---|
| `--color-band-blurry` | `#E9152D` | `rgba(233,21,45,0.10)` | Low Laplacian-variance score — likely blurry |
| `--color-band-review` | `#C55300` | `rgba(197,83,0,0.10)` | Middle band — the user decides |
| `--color-band-sharp` | `#008932` | `rgba(0,137,50,0.10)` | High score — likely sharp |

On-tint text variants (Phase 4 fix F1/F2 — band-chip and score-chip text):

| Token | Value | Measured contrast |
|---|---|---|
| `--color-band-blurry-text` | `#BB1125` | ≈5.0:1 on the blurry tint composite `rgb(241,220,227)`; ≈5.8:1 on `#F2F2F7`; ≈6.5:1 on white |
| `--color-band-review-text` | `#A34400` | ≈4.9:1 on the review tint composite `rgb(238,226,222)`; ≈5.6:1 on `#F2F2F7`; ≈6.2:1 on white |
| `--color-band-sharp-text` | `#007029` | ≈5.0:1 on the sharp tint composite `rgb(218,232,227)`; ≈5.6:1 on `#F2F2F7`; ≈6.3:1 on white |

Rule: band text on a tint or the grouped background always uses `--color-band-*-text` (band chips and tile score chips, §8.1). The base text value stays on white surfaces (notice and empty-state warning icons, §8.2) and non-text uses (chip dots: band-chip dots follow the chip's text color, score-chip dots keep the base band color). Tint fills and chip geometry are unchanged.

Inclusive-color rule (HIG): band color is never the only signal. Every band has a text heading, a count, and a chip with a visible number; the score number appears on every tile.

### 3.4 Media stage and overlays

| Token | Value | Role |
|---|---|---|
| `--color-stage` | `#1C1C1E` | Photo detail stage behind large images (reuses the HIG gray table's Gray6 dark value as a neutral media-viewing dark) |
| `--color-stage-text` | `#FFFFFF` | Labels on the stage |
| `--color-scrim` | `rgba(0,0,0,0.44)` | Modal scrim behind the desktop detail modal |

### 3.5 Color job rules

- Every color signals something: surface = content container; hairline = structure; accent = selection/primary action; band color = analysis verdict; red = blocked error. No decorative color anywhere.
- The accent covers a few percent of any screen. Only one control at a time carries an accent fill (the primary action).
- Same color never means two things: `#0088FF` (non-text tint) and `#1E6EF4` (text/fill) are the same hue family used by rule, not interchangeably.

## 4. Design tokens — typography

### 4.1 Font stack (no webfonts, ever)

```
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;  /* score figures and file metadata only */
```

The system font resolves to SF Pro on Apple devices (the HIG system font) and to each platform's native sans elsewhere. Fonts are never downloaded, vendored, or embedded — this is a hard constraint of the project and also the HIG's own rule (do not embed system fonts).

### 4.2 Type scale

Derived from the HIG iOS Dynamic Type table at the **Large (default)** size. Values in px (1 pt → 1 px for CSS); implementation uses `rem` on a 16 px root so browser text scaling works. Minimum size in the app is 11 px (HIG iOS minimum). Weights are Regular (400) / Semibold (600) only — HIG: avoid light weights; hierarchy comes from size and color, not heavy weights.

| Token | Size / line | Weight | Tracking | Usage |
|---|---|---|---|---|
| `--text-large-title` | 34 / 41 | 400 | `+0.012em` | Empty-state hero title only |
| `--text-title-1` | 28 / 34 | 400 | `+0.014em` | Reserved; unused in v1 screens |
| `--text-title-2` | 22 / 28 | 400 | `−0.012em` | Screen titles, empty/error card headings |
| `--text-title-3` | 20 / 25 | 600 | `−0.025em` | Section headers, band headings, notice headings |
| `--text-headline` | 17 / 22 | 600 | `−0.026em` | Button labels, tile emphasis, detail metadata |
| `--text-body` | 17 / 22 | 400 | `−0.026em` | Body copy, explanations (the default) |
| `--text-callout` | 16 / 21 | 400 | `−0.031em` | Longer explanatory lines under titles |
| `--text-subhead` | 15 / 20 | 400 | `−0.016em` | Secondary descriptions, detail-view captions |
| `--text-footnote` | 13 / 18 | 400 | `−0.006em` | Scores, counts, helper text |
| `--text-caption-1` | 12 / 16 | 400 | `0` | Tile filenames, chip labels |
| `--text-caption-2` | 11 / 13 | 400 | `+0.006em` | The smallest meta: file size, "N files skipped" |

Tracking values come from the HIG SF Pro tracking table at each point size. Small text (below 16 px) never takes negative tracking beyond the table values above; `--font-mono` figures always use `font-variant-numeric: tabular-nums`.

### 4.3 Type rules

- Sentence case everywhere. No uppercase-tracked labels, no italic emphasis, no text below 11 px.
- Hierarchy on a screen: at most one large/title element, one section-header level, and caption/meta levels — never more.
- Layout must not break when text scales (browser zoom to 200% or OS text scaling): labels wrap instead of truncating, except filenames which truncate with an ellipsis *and* have their full name visible in the detail view.

## 5. Design tokens — spacing, radius, depth

### 5.1 Spacing scale (4 px grid)

Everything sits on this scale — margins, paddings, gaps, fixed heights. `2` exists only inside small controls (icon-to-label nudges, chip internals).

| Token | Value | Typical use |
|---|---|---|
| `--space-2` | 2 | Icon-to-label fine alignment |
| `--space-4` | 4 | Inside chips; photo-tile grid gap |
| `--space-8` | 8 | Between an icon and its label; between grouped tiles' meta lines |
| `--space-12` | 12 | Inside cards between elements; between related rows |
| `--space-16` | 16 | Card padding (mobile), control padding |
| `--space-20` | 20 | Card padding (desktop) |
| `--space-24` | 24 | Page edge padding (desktop), between groups |
| `--space-32` | 32 | Between sections; page edge padding (desktop, large) |
| `--space-48` | 48 | Empty-state breathing room above/below |
| `--space-64` | 64 | Hero spacing on the empty state |

Spacing shows grouping: space inside a group is always smaller than space between groups; sibling cards share identical padding; list rows share one height.

### 5.2 Corner radii (nested rule)

Three radii, applied by element type — never one radius everywhere. Inner radius = outer radius − padding, never below 4.

| Token | Value | Applied to |
|---|---|---|
| `--radius-sm` | 6 | Small controls, band chips, score chips, inline badges |
| `--radius-md` | 10 | Buttons, inputs, photo tiles |
| `--radius-lg` | 16 | Cards, drop zone, notice cards, sheets, modals |
| `--radius-full` | 999px | Selection checkmark badge, progress bar, avatar-like circles only |

### 5.3 Depth and shadow rules

Subtle depth only — surfaces and hairlines do the work, shadows confirm it. Per HIG Materials: depth is layering with legibility first, effects used sparingly.

- **Hairlines are the default structure.** Cards, sheets, and the drop zone carry a 1px `--color-hairline` border. Separators inside lists are 1px hairlines with 16px leading/trailing inset.
- **Elevation tokens** (the only two shadows in the app):
  - `--shadow-card`: `0 1px 2px rgba(0,0,0,0.05)` — resting cards and tiles' meta area.
  - `--shadow-floating`: `0 8px 24px rgba(0,0,0,0.06)` — the bottom action bar and the desktop modal only.
- **Never**: colored shadows, glows, blur blobs, neon borders, gradient fills on any surface, gradient text. A gradient is allowed nowhere in this app.
- The header uses translucency, not shadow: `rgba(255,255,255,0.85)` + `backdrop-filter: blur(20px)` + bottom hairline (a standard-material feel in plain CSS).

## 6. Design tokens — motion

Calm motion, only where it communicates state. If a motion cannot be described as "tells the user X changed", it does not exist.

### 6.1 Tokens

| Token | Value |
|---|---|
| `--ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` — the single curve for every transition in the app |
| `--duration-fast` | `120ms` — hover, press, toggle feedback |
| `--duration-standard` | `200ms` — state changes: selection, notice entrance, color/border shifts |
| `--duration-slow` | `320ms` — entrances: sheet/modal rise, band-group reveal |
| `--duration-stagger` | `50ms` — inter-item delay between staggered reveal items (band reveal only) |

Only `color`, `background-color`, `border-color`, `opacity`, and `transform` are ever transitioned. Layout properties (width, height, top, left, margin) are never animated — progress bar fill uses `transform: scaleX()`, never width.

### 6.2 Allowed motion (complete list)

| Motion | Where | Spec |
|---|---|---|
| Drop-zone drag feedback | Empty/upload | Fill shifts to `--color-accent-subtle`, border to accent, `--duration-fast` |
| Button press | All buttons | `transform: scale(0.98)` + fill shift to pressed token, `--duration-fast` |
| Tile selection | Results grid | Checkmark badge scales 0.9 → 1 with `--ease-standard`, `--duration-standard`; ring appears instantly |
| Analysis progress | Analyzing state | Determinate bar via `transform: scaleX(score fraction)`, `--duration-standard` between worker updates; percentage text updates without animation |
| Band-group reveal | Analyzing → Results, once per band | Section fades in and rises 8px, `--duration-slow`, `--duration-stagger` between items, at most six items stagger |
| Sheet / modal entrance | Detail view | Rises 24px and fades on mobile; fades and scales 0.98 → 1 on desktop, `--duration-slow` |
| Spinner | Buttons during download and the brief pre-analysis moment only | 16px inline spinner, 1s linear rotation — the one looping animation, permitted because it communicates in-progress state; never used decoratively |

### 6.3 Forbidden motion

- Nothing loops for decoration: no pulse, ping, breathing glows, floating elements, shimmer, parallax.
- No entrance animation for the page as a whole; no fade-up-on-scroll.
- No bounce, elastic, or spring easing anywhere (`--ease-standard` only).
- No hover scale on cards or tiles; hover is a color/overlay change only.
- All motion collapses under `prefers-reduced-motion: reduce` (§12): transitions drop to near-zero and the spinner remains (it is state, and text alternatives exist).

## 7. Layout & responsive system

Mobile-first: the phone's photo library is the use case, so 375 px is the design base and desktop is the adaptation. HIG Designing-for-iOS grounding: few onscreen controls; primary actions in the middle/bottom thumb-reach zone.

### 7.1 Page shell (single column, no sidebar)

```
┌──────────────────────────────┐
│ header (sticky, translucent) │  44–52px tall; hairline bottom
├──────────────────────────────┤
│ notice cards (optional)      │  in content flow, dismissible
│ content (state-dependent)    │  ← the five screens of §9
├──────────────────────────────┤
│ action bar (when results)    │  sticky bottom; --shadow-floating
└──────────────────────────────┘
```

- Content max-width: none on mobile (full-bleed with page padding); `960px` centered from 768 px up; the photo grid itself may run wider — `1200px` centered on desktop.
- Page padding: 16 px mobile / 24 px ≥768 px / 32 px ≥1280 px.
- Bottom edge: action bar and scroll content respect `env(safe-area-inset-bottom)` (iPhone home indicator).
- Header holds: app title (`--text-headline`), and on results screens the "Start over" text button. It stays 44–52px tall on all breakpoints.

### 7.2 Breakpoints and photo grid

| Range | Grid columns (square tiles, `--space-4` gap) | Notes |
|---|---|---|
| base (design target 375) | 3 | tile meta under each tile |
| ≥ 480 px | 4 | |
| ≥ 640 px | 5 | |
| ≥ 768 px | 7 | content capped 960px; desktop hover states activate |
| ≥ 1024 px | 8 | |
| ≥ 1280 px | 9 | grid capped 1200px |

Tiles are aspect-ratio 1:1, `object-fit: cover`, `--radius-md`. Tile meta (filename + score chip) sits below the tile, single line each, truncating with ellipsis.

### 7.3 Desktop adaptation (how mobile layouts grow)

- **Empty state**: centered card stays centered; gains max-width 480px; the two buttons sit side by side ≥768 px (stacked on mobile).
- **Analyzing**: progress card gains max-width 560px; grid of pending tiles uses the same responsive columns.
- **Results**: identical grid logic; band headers gain a right-aligned "Select all" that is always visible (on mobile it is also always visible — no hover-only affordances).
- **Action bar**: stays a fixed bottom bar at every breakpoint, inner content capped to the content width; on desktop it reads as a floating dock (full-width bar with `--shadow-floating`).
- **Detail**: full-screen sheet on mobile → centered modal, 960×640 max, over `--color-scrim`, on ≥768 px. Prev/next chevrons appear only where a pointer exists (≥768 px); on mobile, swipe left/right navigates.
- **Pointer vs touch**: hover styles are wrapped in `@media (hover: hover)`; touch devices rely on pressed states. All touch targets ≥44×44 px on mobile (HIG); ≥32px with generous spacing on pointer devices.

## 8. Components

### 8.1 Controls

#### Header bar

- Sticky; `rgba(255,255,255,0.85)` + `backdrop-filter: blur(20px)`; bottom hairline. Title left (`--text-headline`), actions right.
- States: default; scrolled (unchanged — translucency already separates); with "Start over" text button on results screens only.

#### Buttons

| Variant | Anatomy | Default | Hover (pointer only) | Pressed | Focus | Disabled |
|---|---|---|---|---|---|---|
| Primary | `--text-headline` white label, `--color-accent-strong` fill, `--radius-md`, 44px min height (mobile) / 36px (desktop), 16–20px side padding | filled | fill lightens 4% | `--color-accent-press` + scale(0.98) | focus ring §12 | fill `--color-surface-muted`, label `--color-text-muted`, no pointer |
| Secondary | same metrics, `--color-surface-muted` fill + hairline, `--color-text` label | filled | `--color-fill-pressed` | `--color-fill-pressed` + scale(0.98) | focus ring | as primary |
| Text button | `--text-headline` label in `--color-accent-strong` on white surfaces, `--color-accent-text` on non-white surfaces (§3.2 rule), no fill | plain | underline appears | opacity 0.7 | focus ring | opacity 0.4 |

Button labels are verbs ("Choose photos", "Download selected"), never with trailing periods.

#### Photo tile (button)

- Anatomy: square thumbnail (object URL, down-scaled by the app; URLs revoked on replacement — Phase 2 implementation note); below it one line filename (`--text-caption-1`, ellipsis) and one line score chip (`--text-footnote`, tabular-nums, 8px band-color dot + number in `--color-band-*-text`, §3.3 on-tint variant).
- Two targets, one tile: the **photo area** is a `<button aria-pressed>` — activating it toggles selection (the primary task is marking photos); the **meta row** is a smaller button (`aria-label="View IMG_4187"`) — activating it opens the detail view (§9d). Both are ≥44px tall on touch.
- Default: plain tile, hairline visible only on the meta area. Desktop hover: `--color-hover-overlay` on the photo (pointer only). Pressed: scale(0.98).
- Selected: 2px inset ring `--color-accent-strong`, `--color-accent-subtle` overlay on the photo, 20px checkmark badge (top-right, `--radius-full`, accent-strong fill, white check icon).
- Focus: focus ring (§12). Loading (thumbnail not yet decoded): `--color-surface-muted` placeholder block, no spinner per tile. Score pending (during analysis): dot renders as an 8px `--color-fill-pressed` circle, number shows "—".

#### Band section header

- Anatomy: band chip (band-tint fill, `--radius-sm`, band text color `--color-band-*-text` per §3.3: dot + "Blurry") + count ("12 photos", `--text-footnote`, `--color-text-secondary`) + right-aligned "Select all" / "Deselect" text button.
- Empty band: header renders with count "0" and the message "No photos in this band" (`--text-subhead`, `--color-text-muted`) instead of a grid. Never hide a band silently.

#### Action bar

- Fixed bottom, full width, `--color-surface` fill, top hairline, `--shadow-floating`, `env(safe-area-inset-bottom)` padding.
- Anatomy: left — selection summary ("3 selected · 24 total", `--text-footnote`, tabular-nums); right — "Add more" secondary button + "Download selected" primary button.
- States: default; disabled (zero selected — primary disabled style; selecting remains possible); busy (during downloads: primary label "Preparing…" with inline spinner; secondary disabled).
- Under the bar on first visit to results: one-line device-reality copy (§13).

### 8.2 Overlays and state surfaces

#### Analysis progress card

- Anatomy: card (`--color-surface`, hairline, `--radius-lg`, 16px padding, max-width 560px): heading "Analyzing photos" (`--text-title-3`); status line "7 of 24" (`--text-footnote`, `--color-text-secondary`, tabular-nums); determinate bar — 4px tall, `--radius-full`, track `rgba(0,0,0,0.06)` (neutral on the white card), fill `--color-accent` via `transform: scaleX()`.
- Below the card: the pending grid — all tiles visible, thumbnails at full opacity, score chips in pending state ("—").
- States: running (updates as the worker reports); done (card is replaced by the grouped results — band reveal motion, §6.2). No cancel control in v1; analysis of typical batches is seconds.

#### Detail view (photo review)

- Mobile (<768 px): full-screen sheet on `--color-stage`; slides up 24px + fades (`--duration-slow`).
- Desktop (≥768 px): centered modal, max 960×640, over `--color-scrim`; fades + scales 0.98→1.
- Anatomy: top bar — "Done" text button left; filename center (`--text-headline`, ellipsis, full name in tooltip/`title`); right — "Select" toggle (primary when off → becomes secondary with check when on) — and on desktop only, prev/next chevron buttons flanking the stage. Stage: the photo at full resolution, `object-fit: contain`, centered on `--color-stage`. Bottom bar — score chip (band dot + number + band word in the stage band tokens, note below) plus "Download this photo" primary button.
- Stage band-color note: the light-appearance band text values fail contrast on `--color-stage`, so the detail stage uses the HIG table's dark-mode variants — blurry `#FF4245`, review `#FFA056` (orange accessible dark), sharp `#4AD968` (green accessible dark). All three verify ≥≈4.9:1 on `#1C1C1E`. These are stage-only tokens: `--color-band-blurry-stage`, `--color-band-review-stage`, `--color-band-sharp-stage`.
- States: opening (motion); navigating (image swaps without transition — instant, Apple-like); selected/unselected toggle; last/first (chevron disabled); close via "Done", Escape, scrim click (desktop), swipe-down (mobile).

#### Notice cards (undecodable files, errors)

- Anatomy: card (`--color-surface`, hairline, `--radius-lg`), 16px padding, leading 20px warning icon (warnings use the review-orange family — `--color-band-review`'s text value — never red; red is reserved for the blurry verdict and blocked errors), heading (`--text-title-3`), body (`--text-subhead`, `--color-text-secondary`), optional `details/summary` filename list (`--text-caption-1`, mono for filenames), trailing "Dismiss" text button.
- Undecodable-files variant: heading "N files couldn't be opened"; body explains the browser could not decode them and nothing was changed; summary lists skipped filenames.
- Generic-error variant: heading "Something went wrong"; body names the failed step; actions: "Try again" (primary) + "Dismiss".
- Placement: first element in content flow — never a modal, never a toast for recoverable conditions. Entrance: fade only, `--duration-standard`.

#### Empty state (upload)

- Anatomy: centered card (max-width 480px, no visible border on mobile — the card is the composition): app mark optional; hero title "Find the blurry photos" (`--text-large-title`); one body line (`--text-body`, `--color-text-secondary`) stating what happens to the photos; primary button "Choose photos" 48px tall; secondary affordances beneath: "or drop photos here" caption (`--text-subhead`, `--color-text-muted`) and — when supported — the "Choose folder" secondary button (§11); privacy line at the bottom (`--text-caption-1`, `--color-text-muted`).
- The drop zone is the entire content area: on dragover it tints `--color-accent-subtle` and the hairline outline turns accent (`--duration-fast`).
- Variant (all files failed to open): same composition, warning icon above the title, title "Couldn't open those files", body suggests trying JPEG photos.

#### Icon set

- Inline SVG only (no icon font, no CDN, no emoji). One set, `stroke="currentColor"`, 1.5px stroke, 20px default size, single color from the text role it sits in. Inventory: photo (empty state), folder (folder pick), check (selection badge), x (dismiss/close), chevron-left/right (detail nav), download (buttons), warning-triangle (notices). No trash icon exists anywhere in the app — the app cannot delete files (§13).

## 9. Screen wireframes

ASCII layouts at the 375 px mobile base. Every element references the tokens of §3–§8. Desktop notes follow each wireframe (see also §7.3).

### 9a. Empty / upload state

```
┌──────────────────────────────────────┐
│ ▪ header: "Blurry Photo Cleaner"     │  --text-headline, translucent, hairline
├──────────────────────────────────────┤
│                                      │
│         (space-64 above)             │
│                                      │
│      ┌──────────────────────┐        │
│      │   [photo icon 40px]  │        │  inline SVG, --color-text-muted
│      │                      │        │
│      │  Find the blurry     │        │  --text-large-title, center
│      │  photos              │        │
│      │                      │        │
│      │  Choose photos from  │        │  --text-body, --color-text-secondary,
│      │  your library — they │        │  center, max-width 30ch
│      │  stay on this device │        │
│      │                      │        │
│      │  ┌────────────────┐  │        │
│      │  │  Choose photos │  │        │  primary button, 48px tall
│      │  └────────────────┘  │        │
│      │                      │        │
│      │  Choose folder       │        │  secondary button — ONLY when
│      │                      │        │  showDirectoryPicker is detected (§11)
│      │  or drop photos here │        │  --text-subhead, --color-text-muted
│      └──────────────────────┘        │
│                                      │
│   Photos never leave this device     │  --text-caption-1, --color-text-muted
│         (space-48 below)             │
└──────────────────────────────────────┘
```

- The card boundary is invisible; whitespace composes it. The drop zone is the whole content area (§8.2).
- Without folder-pick support the secondary button is absent and the layout is identical otherwise — nothing shifts, nothing is disabled-looking.
- Desktop (§7.3): card centers vertically in the viewport, max-width 480px; "Choose photos" and "Choose folder" sit side by side.

### 9b. Analyzing with progress

```
┌──────────────────────────────────────┐
│ ▪ header: "Blurry Photo Cleaner"     │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ Analyzing photos                 │ │  --text-title-3
│ │ 7 of 24                          │ │  --text-footnote, tabular-nums,
│ │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░  │ │  --color-text-secondary
│ │                                  │ │  4px bar: track rgba(0,0,0,0.06),
│ └──────────────────────────────────┘ │  fill --color-accent, scaleX()
│                                      │
│ Photos  (pending grid, 3 columns)    │  --text-footnote section label
│ ┌─────┐ ┌─────┐ ┌─────┐              │
│ │ img │ │ img │ │ img │              │  thumbnails full opacity
│ └─────┘ └─────┘ └─────┘              │
│ IMG_4021  IMG_4022  IMG_4023         │  --text-caption-1, ellipsis
│ ● —     ● —     ● —                  │  pending chip: --color-fill-pressed
│ ┌─────┐ ┌─────┐ ┌─────┐              │  dot, number "—" (§8.1)
│ │ img │ │ img │ │ …   │              │
├──────────────────────────────────────┤
│ (no action bar in this state)        │
└──────────────────────────────────────┘
```

- The score line under every tile stays visible with pending chips, so the grid's height does not jump when scores land.
- The progress card is the only content above the grid; it is removed (not collapsed) when analysis completes, and the grouped results replace the pending grid in the same scroll position, with the band reveal (§6.2).
- The header keeps no buttons here. The percentage lives in the card text and in an `aria-live` region (§12).
- Desktop (§7.3): progress card max-width 560px, centered; grid columns per §7.2.

### 9c. Grouped results grid

```
┌──────────────────────────────────────┐
│ ▪ header: "Results"    [Start over]  │  text button, right
├──────────────────────────────────────┤
│ (undecodable notice card when any    │  §9e — first in flow when present
│  files were skipped)                 │
│                                      │
│ (● Blurry) 12 photos    [Select all] │  band header §8.1: chip in
│ ┌─────┐ ┌─────┐ ┌─────┐              │  --color-band-blurry tint, text
│ │ img │⊕│ img │ │ img │              │  --color-band-blurry (text value)
│ └─────┘ └─────┘ └─────┘              │
│ IMG_4187  IMG_4190  IMG_4203         │
│ ● 23    ● 31    ● 12                 │  score chip: band dot, tabular
│ (space-32 between bands)             │
│ (● Needs review) 5 photos [Deselect] │
│ ┌─────┐ ┌─────┐ ┌─────┐              │
│ │ img │ │ img │⊕│ img │              │  ⊕ = selected tile: 2px accent ring,
│ └─────┘ └─────┘ └─────┘              │  accent-subtle overlay, check badge
│ IMG_4211  IMG_4215  IMG_4218         │
│ ● 54    ● 61    ● 47                 │
│ (space-32)                           │
│ (● Sharp) 7 photos      [Select all] │
│ ┌─────┐ ┌─────┐ ┌─────┐              │
│ │ img │ │ img │ │ img │              │
│ └─────┘ └─────┘ └─────┘              │
│ IMG_4001  IMG_4002  IMG_4010         │
│ ● 88    ● 92    ● 76                 │
│                                      │
├──────────────────────────────────────┤
│ 3 selected · 24 total                │  --text-footnote, tabular
│ [Add more]  [Download selected]      │  secondary + primary; primary
│ Review here, delete these files on   │  disabled when 0 selected
│ your phone (first-visit line, §13)   │
└──────────────────────────────────────┘
```

- Bands render in fixed order Blurry → Needs review → Sharp, matching the user's task (blurry first). An empty band renders its header with "0" and "No photos in this band" (§8.1).
- "Start over" clears everything with a native `confirm()`; "Add more" re-enters §9b for the newly added files only.
- Tile activation follows the two-target rule (§8.1): tapping the photo toggles selection (⊕ ring + check badge); tapping the filename/score row opens §9d. The download action produces sequential anchor downloads with the busy state (§8.1).
- Desktop (§7.3): 7–9 columns; band headers' "Select all" right-aligned to the grid edge; action bar reads as a floating dock, content capped to 1200px.

### 9d. Photo detail / review

Mobile — full-screen sheet:

```
┌──────────────────────────────────────┐  sheet on --color-stage (#1C1C1E)
│ [Done]     IMG_4187.jpg     [Select] │  "Done" text (white), filename
├──────────────────────────────────────┤  --text-headline white, ellipsis
│                                      │
│                                      │
│           ┌──────────────┐           │
│           │              │           │
│           │  photo, full │           │  --color-stage around it,
│           │  resolution  │           │  object-fit: contain
│           │  (contain)   │           │
│           │              │           │
│           └──────────────┘           │
│                                      │
│  ‹ swipe ›                           │  swipe left/right navigates
├──────────────────────────────────────┤
│ ● 23 · Blurry                        │  stage chip: dot + number +
│ [Download this photo]                │  band word in
└──────────────────────────────────────┘  --color-band-blurry-stage
                                         (§8.2); primary button
```

Desktop (≥768 px) — centered modal over `--color-scrim`, max 960×640:

```
      ┌───────────────────────────────────┐
      │ IMG_4187.jpg        [Select][Done]│  title bar
      ├───────────────────────────────────┤
      │                                   │
   ‹  │      photo (contain, centered)    │  ›   chevron buttons flank
      │                                   │      the stage (desktop only)
      ├───────────────────────────────────┤
      │ ● 23 · Blurry      [Download this photo] │
      └───────────────────────────────────┘
```

- "Select" toggles the tile's selection state from the detail view (same `aria-pressed` semantics); the label becomes "Selected" with a check glyph when on, and the button switches primary→secondary-with-check (§8.1 states).
- Prev/next wrap nothing: at the first/last photo of the current band the chevron disables. Escape, "Done", scrim click (desktop), or swipe-down (mobile) close back to §9c at the same scroll position.
- The full filename is always recoverable here (title attribute / long-press), because the grid truncates it (§4.3).

### 9e. Error / undecodable-file notice

The notice overlays content flow — it never blocks. Two variants:

Undecodable files (results continue below — the common case, e.g. HEIC on an unsupported browser):

```
┌──────────────────────────────────────┐
│ ▪ header: "Results"    [Start over]  │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ ⚠ 3 files couldn't be opened     │ │  warning icon --color-band-review
│ │                                  │ │  (text value), 20px; --text-title-3
│ │ Your browser can't decode these  │ │  --text-subhead, secondary
│ │ formats. They were skipped —     │ │
│ │ nothing was changed.             │ │
│ │ ▸ See the 3 files                │ │  <details> summary,
│ │   IMG_4331.HEIC                  │ │  filenames in --font-mono,
│ │   IMG_4332.HEIC                  │ │  --text-caption-1
│ │   IMG_4340.HEIC                  │ │
│ │ iPhone HEIC photos may need      │ │  helper, --text-caption-1, muted
│ │ converting to JPEG first.        │ │
│ │                        [Dismiss] │ │  text button
│ └──────────────────────────────────┘ │
│ (● Blurry) 12 photos   [Select all]  │  ← results continue normally
│ ┌─────┐ ┌─────┐ ┌─────┐              │
│ │ img │ │ img │ │ img │  …           │
├──────────────────────────────────────┤
│ 0 selected · 21 total                │  counts exclude the 3 skipped
│ [Add more]  [Download selected]      │
└──────────────────────────────────────┘
```

All files failed (no results exist):

```
┌──────────────────────────────────────┐
│ ▪ header: "Blurry Photo Cleaner"     │
├──────────────────────────────────────┤
│         (space-48)                   │
│         [warning icon 40px]          │  --color-band-review (text value)
│    Couldn't open those files         │  --text-title-2
│    Try JPEG or PNG photos — this     │  --text-body, secondary
│    browser couldn't decode them.     │
│    Nothing was changed.              │
│                                      │
│      [ Choose photos ]               │  primary, 48px
│         (space-48)                   │
└──────────────────────────────────────┘
```

Analysis failure (worker error mid-run):

- The progress card of §9b is replaced by the generic-error notice (§8.2: "Something went wrong" + "Try again" primary + "Dismiss"); any photos already scored stay in §9c below the notice. "Try again" re-queues only unscored photos.
- Notice behavior: entrance is a fade (`--duration-standard`); dismissal removes only the card; counts in §9c always exclude skipped files; `aria-live` announces the notice (§12).
- Desktop (§7.3): both variants center at their mobile widths; the undecodable notice spans the 960px content width in flow.

## 10. App state machine

```
                    ┌────────────┐   files chosen / dropped / picked
                    │ 9a empty   │ ────────────────────────────┐
                    └────────────┘                             ▼
                    ▲  "Start over"      ┌──────────────────────────┐
                    │  (confirm)         │ 9b analyzing + progress  │
                    │                    │  (worker scores files)   │
                    │                    └──────────────────────────┘
                    │                       │ all scored            │ analysis error
                    │                       ▼                       ▼
┌ add more / re-run ┘              ┌──────────────┐        ┌────────────────┐
└───────────────────────────────── │ 9c results   │        │ 9e error notice│
                                   │ (grouped)    │◄───────│ over 9c        │
                                   └──────────────┘ retry  └────────────────┘
                                    │ ▲    │
                       open/close   │ │    │ undecodable files at pick time:
                       (§9d overlay)│ ▼    ▼  9e notice renders above 9c
                                   ┌──────────────┐
                                   │ 9d detail    │
                                   └──────────────┘
```

- The five wireframes are the five states; notices (§9e) are overlays on 9a/9b/9c, not standalone destinations.
- Undecodable files are recorded at pick time and the notice is shown in every later state until dismissed; counts everywhere exclude them (nothing is silently dropped — plan requirement).
- "Add more" from 9c appends files and re-enters 9b for the new files only; existing scores persist.
- Zero-selected does not block any state; it only disables the primary download action (§8.1).
- Scroll position is preserved across 9c → 9d → 9c.

## 11. Progressive enhancement — folder pick

**The folder-pick affordance is progressive enhancement only. It is feature-detected and is never a dependency of any flow.** (Plan Phase 1 acceptance criterion; Decision Record route C.)

- Base flow, always present: `<input type="file" accept="image/*" multiple>` behind the "Choose photos" button, plus drag-and-drop onto the whole content area (§8.2, §9a).
- Enhancement 1 — folder pick: the "Choose folder" secondary button is rendered **only if** `typeof window.showDirectoryPicker === "function"` and the context is secure. On browsers without it (all iOS browsers today; Firefox), the button does not exist in the DOM — the screen does not show a disabled control, a tooltip, or any placeholder (§9a).
- Enhancement 2 — `webkitdirectory`: optional, second-priority fallback behind `showDirectoryPicker()`; support is unverified per the plan, so it must itself be feature-detected (`"webkitdirectory" in HTMLInputElement.prototype`) and may ship later without spec changes. The Reviewer verifies support in Phase 2 or the feature is dropped.
- No state, copy, or layout may assume folder pick exists. The empty state renders identically without it (§9a note), and no results or review flow references folders.
- All paths feed the same photo store; the source of a file (picker, drop, folder) is invisible downstream.

## 12. Accessibility

- **Contrast** — verified in §3: body text 21:1; secondary text ≈6:1; muted meta ≈5.1:1; white on accent-strong ≈4.6:1; band text ≈4.5:1 on white; stage band text ≥≈4.9:1 on the stage. Phase 6 verifies against current WCAG 2.2 guidance (plan gate).
- **Focus** — a single visible focus style: `outline: 2px solid --color-accent-strong; outline-offset: 2px`, applied via `:focus-visible` only (pointer clicks never show it). On `--color-stage` (dark imagery), the ring uses `--color-stage-text` instead. The drop zone, every tile, every button, "Dismiss", `details/summary`, and detail-view controls are keyboard-reachable in DOM order; Escape closes the detail view; the detail sheet traps focus while open and returns it to the originating tile on close.
- **Touch targets** — ≥44×44px on touch (§7.3): tiles, buttons, dismiss, "Select all"; the 20px checkmark badge is not a separate target.
- **Semantics** — tiles are `<button aria-pressed>`; band sections are headings (`h2`/`h3` order: h1 app title → h2 band/section names); notices use `role="status"`; the progress card exposes `role="progressbar"` with `aria-valuenow/max`.
- **Live regions** — one polite `aria-live` region announces: "Analyzing 7 of 24", "Analysis complete: 12 blurry, 5 need review, 7 sharp", notice appearances, and "Preparing 3 photos" download status. Percentages update by text change, not animation (§6.2).
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` sets all transition durations to 1ms and disables the band reveal and sheet rise; the inline spinner persists (it is state feedback with a text alternative: "Preparing…").
- **Inclusive color** — band membership is always readable without color: band headings, counts, band word in the detail chip, and the score number on every tile (§3.3).

## 13. Copy rules

- Voice: plain, honest, unhurried. Sentence case; no exclamation marks; no hype words; labels and buttons without trailing periods; body sentences keep theirs.
- Numbers: tabular figures, one format ("7 of 24", "12 photos", "3 selected · 24 total").
- **Device-reality copy (plan-mandated, must appear in the review flow)**: the app cannot delete files from the phone. Required near the download action (§8.1, §9c): *"Review here, delete these files on your phone."* No copy anywhere implies the app deletes, trashes, or frees storage by itself — there is no trash icon (§8.2).
- **Privacy line (empty state, §9a)**: *"Photos never leave this device."* This is the promise Phase 5 verifies; it must stay literally true in implementation (no network requests).
- Undecodable files are always named and counted (§9e) — never "some files failed".
- Filename truncation in grids is a display concern; the detail view always reveals the full name (§9d).
- No greeting copy, no product-self-praise ("blazing fast"), no invented claims.

## 14. Prohibitions & dependency statement

### 14.1 Zero-dependency statement (plan acceptance criterion)

**No framework, no build tool, and no external font (or icon) dependency appears anywhere in this spec or its implementation.** The app is plain HTML, CSS, and vanilla JavaScript: no `package.json`, no bundler, no CDN links, no webfonts, no icon fonts, no external images. Type comes from the system font stack (§4.1); icons are inline SVG (§8.2); all color and motion are tokens in this spec. This constraint also keeps Phase 5's zero-network promise trivially checkable.

### 14.2 Prohibitions (the reject list, made absolute for this app)

Never in any screen, state, or breakpoint:

- Glows, colored shadows, gradient fills or gradient text, blur blobs, neon borders, glassmorphism effects beyond the header's standard-material translucency (§5.3).
- Looping or decorative motion of any kind beyond the single spinner (§6.2–6.3); bounce/elastic easing.
- The colored left-border panel — including on notices; notices are hairline cards (§8.2). Purple-to-blue gradients; emoji as icons or labels; uppercase tracked labels; italic emphasis.
- One corner radius everywhere (nested radii per §5.2); cards nested inside cards; glowing pills for counts or badges.
- More than one accent color; accent as body-text color; `#0088FF` as text (§3.2).
- Disabled-look controls for unsupported features (absent instead — §11); modal alerts for recoverable conditions (§8.2).
- Delete affordances of any kind (§13).
- Any element below 11px; any text outside the §4.2 scale; any spacing, radius, or duration value outside the §5–§6 tokens.

### 14.3 Deliberate exceptions kept (with reasons)

- The header's `backdrop-filter` translucency (§5.3): an Apple standard-material pattern, communicates layering over scrolling content, degrades to opaque white where unsupported.
- The single rotating spinner (§6.2): loops, but communicates in-progress state with a text alternative — the delegation's "motion only where it communicates state" permits exactly this.
- The reduced-motion `1ms` duration floor (§12): not a design duration — it is the accessibility collapse of §6.3/§12 under `prefers-reduced-motion: reduce`, keeping state changes effectively instant for vestibular safety.
