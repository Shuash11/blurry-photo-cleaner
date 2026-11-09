# Blurry Photo Cleaner — Design Spec v3 (premium dark glass)

**Status:** Approved by user 2026-11-08 ("premium dark glass", Linear/Vercel reference, visual + layout polish, all features preserved). Design of record for the v0.5 restyle; supersedes design-spec-v2.md §4 tokens.
**Scope for implementer:** restyle `css/style.css` (full `:root` replacement + rule updates) + 3 one-line markup tweaks (§5) + e2e token-assertion updates. All existing class names, selectors, states, and semantics stay. **JS↔CSS contracts — do not rename/remove:** `--duration-stagger` (read by `ResultsView.readStaggerMs`, fallback `STAGGER_FALLBACK_MS = 50` must still match), `--action-bar-h` (written by `ReviewControls`' ResizeObserver), `--hd-fill` (written by the HD slider), `--header-h` (used in `calc()`). Keep the `[hidden]{display:none!important}` guard, the global `:focus-visible` system with stage/hd-panel overrides, every `@supports not (backdrop-filter…)` fallback (one per glass surface), and the `prefers-reduced-motion` block (extended, §7). No webfonts, no inline styles, no new hex outside `:root`.

## 1. Design principles

1. **Depth is a ladder, not a flat grey** — rich near-black base, four clearly separated surfaces, 1px white-alpha hairlines + top-edge highlights; elevation reads through shadow + fill, hairline is reinforcement only.
2. **Glass only where content scrolls underneath** — sticky header, action bar, detail bars, dialogs; every glass surface has a certified worst-case (over pure white) contrast budget and a solid fallback.
3. **One accent, spent deliberately** — indigo-blue on the primary CTA, selection, focus, and progress; the red/amber/green verdict system stays semantic and is never used decoratively.
4. **Numbers are data** — tabular numerals everywhere a count/score/size appears; score chips become tinted pill badges; mono for dimensions and filenames.
5. **Motion states, never decorates** — one entrance family (fade + ≤12px rise), press/hover feedback ≤200ms, the wipe sweep and readout slide as the only narrative animations; all collapse under reduced motion.

## 2. Token sheet — full `:root` replacement

```css
:root {
  /* — Surfaces ladder (deep cool near-black, Linear-class) — */
  --color-bg: #0A0B0D;              /* page; body adds a fixed radial glow, see §3 */
  --color-surface: #121418;         /* cards: notice, progress, hd-panel, tile placeholder */
  --color-surface-raised: #191C22;  /* badges, segmented checked pills, floating bits */
  --color-surface-muted: #1F232B;   /* control fill: btn-secondary, pills, track-ish fills */
  --color-fill-pressed: #2A2F38;    /* hover/press of control fills */

  /* — Glass (always with @supports fallback to --color-surface-raised) — */
  --glass-header: rgba(10, 12, 16, 0.82);   /* app header */
  --glass-bar: rgba(10, 12, 16, 0.92);      /* action bar */
  --glass-stage: rgba(10, 11, 13, 0.74);    /* detail top/bottom bars */
  --glass-dialog: rgba(18, 20, 26, 0.86);   /* confirm / hd-dialog / export chooser */
  --glass-card: rgba(18, 20, 26, 0.72);     /* empty-state card */
  --glass-blur: 24px;
  --glass-saturate: 140%;

  /* — Text ramp — */
  --color-text: #F5F6F7;
  --color-text-secondary: #A6AFBC;
  --color-text-muted: #818A97;      /* never on glass-stage/glass-dialog surfaces (§2.2 rule) */

  /* — Hairlines / overlays / edges — */
  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-separator-strong: rgba(255, 255, 255, 0.16);
  --color-hover-overlay: rgba(255, 255, 255, 0.06);
  --color-track: rgba(255, 255, 255, 0.10);
  --edge-highlight: rgba(255, 255, 255, 0.06);          /* inset 0 1px 0 … top edge */
  --color-veil: rgba(8, 10, 13, 0.66);                  /* wipe labels, tiny chips over photos */
  --color-on-light: #0A0B0D;                            /* ink on white (wipe chevrons, handle) */

  /* — Accent family (indigo-blue; hover/press DARKEN to hold the white label) — */
  --color-accent: #4262FF;              /* fill; white label 4.75:1 */
  --color-accent-hover: #3B57F0;        /* white label 5.52:1 */
  --color-accent-press: #3149D6;        /* white label 6.87:1 */
  --color-accent-text: #8FA6FF;         /* accent text/links/rings on dark */
  --color-accent-subtle: rgba(143, 166, 255, 0.14);  /* selection tint, checked pills, dragover */
  --color-on-accent: #FFFFFF;
  --glow-cta: 0 4px 16px rgba(66, 98, 255, 0.35);    /* CTA only */

  /* — Verdict bands (fill = dots/icons; text = text/tint labels) — */
  --color-band-blurry: #E5484D;         --color-band-blurry-text: #FF9595;
  --color-band-review: #F5A524;         --color-band-review-text: #FFC46B;
  --color-band-sharp: #30A46C;          --color-band-sharp-text: #52D273;
  --color-band-blurry-tint: rgba(229, 72, 77, 0.15);
  --color-band-review-tint: rgba(245, 165, 36, 0.15);
  --color-band-sharp-tint: rgba(47, 191, 113, 0.14);

  /* — Media stage (deeper than the app) — */
  --color-stage: #07080A;
  --color-stage-text: #FFFFFF;
  --color-scrim: rgba(4, 5, 7, 0.66);
  --color-band-blurry-stage: #FF6B6E;
  --color-band-review-stage: #FFA94D;
  --color-band-sharp-stage: #43D17C;

  /* — Typography (system stacks unchanged; weights 400/600/700) — */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-large-title: 2.125rem;  --line-large-title: 2.5rem;   --track-large-title: -0.02em;  /* 34/40 */
  --text-title-1: 1.75rem;       --line-title-1: 2.125rem;     --track-title-1: -0.014em;     /* 28/34, reserved */
  --text-title-2: 1.375rem;      --line-title-2: 1.75rem;      --track-title-2: -0.012em;     /* 22/28 */
  --text-title-3: 1.25rem;       --line-title-3: 1.5625rem;    --track-title-3: -0.02em;      /* 20/25 */
  --text-headline: 1.0625rem;    --line-headline: 1.375rem;    --track-headline: -0.014em;    /* 17/22 */
  --text-body: 1.0625rem;        --line-body: 1.375rem;        --track-body: -0.014em;        /* 17/22 */
  --text-callout: 1rem;          --line-callout: 1.3125rem;    --track-callout: -0.014em;     /* 16/21 */
  --text-subhead: 0.9375rem;     --line-subhead: 1.25rem;      --track-subhead: -0.01em;      /* 15/20 */
  --text-footnote: 0.8125rem;    --line-footnote: 1.125rem;    --track-footnote: 0;           /* 13/18 */
  --text-caption-1: 0.75rem;     --line-caption-1: 1rem;       --track-caption-1: 0.004em;    /* 12/16 */
  --text-caption-2: 0.6875rem;   --line-caption-2: 0.875rem;   --track-caption-2: 0.02em;     /* 11/14 */
  --text-micro: 0.6875rem;       --line-micro: 1rem;           --track-micro: 0.08em;         /* 11/16, uppercase labels */

  /* — Spacing (4px grid, unchanged) — */
  --space-2: 2px; --space-4: 4px; --space-8: 8px; --space-12: 12px; --space-16: 16px;
  --space-20: 20px; --space-24: 24px; --space-32: 32px; --space-48: 48px; --space-64: 64px;

  /* — Radius (restrained) — */
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px; --radius-full: 999px;

  /* — Shadows (ambient pair + directional, warm-dark) — */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.50);
  --shadow-2: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);
  --shadow-3: 0 24px 64px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.40);
  /* Legacy aliases so un-migrated rules keep working during the restyle: */
  --shadow-card: var(--shadow-1);
  --shadow-floating: var(--shadow-3);

  /* — Motion — */
  --ease-standard: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms; --duration-standard: 200ms; --duration-slow: 320ms; --duration-stagger: 50ms;

  /* — Shell metrics — */
  --header-h: 52px;   /* ≥768px: 56px */
  --page-pad: var(--space-16);
}
```

### 2.1 Contrast table — text pairs (requirement ≥4.5:1)

All ratios computed with the WCAG relative-luminance formula on the exact token pair.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--color-text` #F5F6F7 | bg / surface / raised / surface-muted / fill-pressed | 18.20 / 17.04 / 15.77 / 14.55 / 12.42 | PASS |
| `--color-text-secondary` #A6AFBC | bg / surface / raised / surface-muted / fill-pressed | 8.89 / 8.32 / 7.70 / 7.11 / 6.07 | PASS |
| `--color-text-muted` #818A97 | bg / surface / raised / surface-muted / stage | 5.64 / 5.28 / 4.89 / 4.51 / 5.74 | PASS |
| `--color-on-accent` #FFF | accent #4262FF / hover #3B57F0 / press #3149D6 / CTA gradient (darkens top→bottom) | 4.75 / 5.52 / 6.87 / ≥4.75 | PASS |
| `--color-accent-text` #8FA6FF | bg / surface / raised / surface-muted / stage | 8.50 / 7.96 / 7.37 / 6.80 / 8.65 | PASS |
| `--color-accent-text` | accent-subtle (0.14) over surface | 6.32 | PASS |
| Band text blurry #FF9595 | bg / surface / blurry-tint over surface / over bg | 9.36 / 8.77 / 7.55 / 8.22 | PASS |
| Band text review #FFC46B | bg / surface / review-tint over surface / over bg | 12.53 / 11.73 / 8.95 / 9.91 | PASS |
| Band text sharp #52D273 | bg / surface / sharp-tint over surface / over bg | 10.15 / 9.50 / 7.62 / 8.40 | PASS |
| Stage bands #FF6B6E / #FFA94D / #43D17C | stage #07080A | 7.23 / 10.53 / 10.16 | PASS |
| `--color-stage-text` #FFF @ 0.72 (`.detail__size`) | stage | 10.32 | PASS |
| `.btn-delete` #FF9595 | dialog glass worst case (0.86 over pure white ⇒ #333739) | ≈5.7 | PASS |

### 2.2 Glass worst-case table (glass over a **pure white photo** — the lightest possible composite)

| Surface | Composite over white | White text | text-secondary | accent-text | text-muted |
|---|---|---|---|---|---|
| header `.82` ⇒ #36383B | — | 11.76 | 5.31 | **5.08** | n/a (not used) |
| action bar `.92` ⇒ #1E1F23 | — | 15.22 | 7.43 | 7.11 | 4.72 |
| stage bars `.74` ⇒ #4A4A4C | 8.84 | — | 3.99 ✗ (don't use) | n/a | n/a |
| dialog `.86` ⇒ #333739 | 11.4 | — | 5.5 | n/a | **3.4 ✗ — rule: no muted text on dialog glass** |
| wipe label veil `.66` ⇒ #5C5D5F | 6.59 | — | — | — | — |

**Usage rule:** on `--glass-stage` and `--glass-dialog`, use only `--color-stage-text`/`--color-text` and `--color-text-secondary`. `--color-text-muted` is allowed on header, action bar, and solid surfaces only.

### 2.3 Non-text UI pairs (requirement ≥3:1, WCAG 1.4.11)

| Element | Pair | Ratio | Verdict |
|---|---|---|---|
| Focus ring `--color-accent-text` | vs surface / bg | 7.96 / 8.50 | PASS |
| Focus ring on stage (white) | vs stage | 20.04 | PASS |
| Selection ring `--color-accent` | vs surface / bg | 3.88 / 4.15 | PASS (paired with dark outer contour + badge, see §4.3) |
| Slider thumb `--color-accent-text` | vs track (0.10 white over surface) | 6.05 | PASS |
| Progress fill `--color-accent-text` | vs track | 6.05 | PASS |
| Band dots (fill tokens) | vs surface | 4.71 / 9.03 / 5.84 | PASS |
| Band dots | vs own tint over bg | 4.42 / 7.63 / 5.16 | PASS |
| Check badge (white icon on accent) | vs accent | 4.75 | PASS |
| Spinner arc (white) on accent fill | vs accent | 4.75 | PASS |
| Wipe chevrons `--color-on-light` | vs white handle | 19.69 | PASS |
| Hairline / fill steps (surface vs bg 1.07, hairline 1.19–1.62, track 1.32) | — | — | **decorative reinforcement only** — every component boundary is also carried by fill delta + shadow + highlight; no state or boundary relies on hairline alone |

## 3. Typography, spacing, and page chrome

- **Family/weights:** system stacks unchanged. Weights 400 (body), 600 (all headings, buttons, chips, labels), 700 reserved for `.empty-state__title` only.
- **Ramp:** sizes as in the token block. Changes vs v2: large-title 34/40, weight 400→**600**, tracking +0.012em→**−0.02em**; title-3 tracking −0.025→−0.02em; caption-2 line 13→14 and tracking +0.02em (it is now an uppercase badge size); new `--text-micro` for uppercase micro-labels (11/16, 600, `text-transform: uppercase`, letter-spacing 0.08em, color `--color-text-muted` or band/secondary per context).
- **Numerals:** `font-variant-numeric: tabular-nums` mandatory on: `.chip`, `.band__count`, `.gallery-toolbar__count`, `.action-bar__summary`, `.progress-card__status`, `.detail__chip`, `.detail__size`, `.hd-readout`, `.hd-slider__value`, `.hd-progress__*`.
- **Body background:** `background: radial-gradient(120% 60% at 50% -10%, rgba(66,98,255,0.07), transparent 60%) fixed, var(--color-bg);` — one quiet glow behind the first screenful; all text pairs verified on the darker base remain ≥ that ratio with the glow (it lightens the base by <2%). **Implementer note (Lead):** the v2-r3 e2e reads `body` background-color; keep `background-color: var(--color-bg)` and add the glow as a separate `background-image` so the computed `background-color` stays `rgb(10,11,13)`.
- **Header (`.app-header`):** height `var(--header-h)` (52px; 56px at ≥768), `background: var(--glass-header)`, `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))`, fallback `--color-surface-raised`, `border-bottom: 1px solid var(--color-hairline)`. `.app-title`: 17/600. `.icon--mark`: `color: var(--color-accent-text)`, 24px. `#start-over-btn` (`.btn-text`): accent-text — 5.08 worst-case on header glass (was 3.27 — fixed).
- **Spacing rules:** page gutter `--page-pad` (16 / 24 at 768 / 32 at 1280). Card padding: notice/progress/hd-panel **20px**; dialogs **20px**; empty-state card **24px** mobile / **48px** desktop; band header → grid gap 12; band sections separated by `margin-top: 32`; content → first band 24. Nested radius rule kept: inner = outer − padding, floor 4.

## 4. Per-screen component specs

### 4.1 Empty / upload state (`.empty-state`, `.content`)

- **Layout** — mobile: card fills width minus page-pad, top margin 24; desktop ≥768: outer `.empty-state` keeps `min-height: calc(100svh - var(--header-h))`, centers content; card `max-width: 560px`.
- **Card** (new wrapper `.empty-state__card`, §5): `background: var(--glass-card)`; `backdrop-filter: blur(var(--glass-blur))`; fallback `--color-surface-raised`; `border: 1.5px dashed rgba(255,255,255,0.14)`; `border-radius: var(--radius-lg)`; `padding: 40px 24px` / ≥768 `48px 48px`; `box-shadow: var(--shadow-2), inset 0 1px 0 var(--edge-highlight)`.
- **Icon tile** `.empty-state__icon`: 56×56, `border-radius: var(--radius-md)`, `background: var(--color-accent-subtle)`, `border: 1px solid var(--color-hairline)`, icon 28px `color: var(--color-accent-text)`. Failed variant: `background: var(--color-band-review-tint)`, icon `#FFC46B` (via `--color-band-review-text`).
- **Title**: 34/40, weight 700, `color: var(--color-text)`, margin-top 24. **Body**: 17/`--color-text-secondary`, max-width 34ch, margin-top 12. **Actions**: row gap 12, margin-top 32; **drop hint** 15 muted margin-top 16 (touch-hidden rule kept); **privacy** 12 muted margin-top 40.
- **Hero CTA** `.btn-primary.btn-hero`: 48px tall, `background-image: linear-gradient(180deg, var(--color-accent) 0%, #3550E8 100%)` over `background-color: var(--color-accent)` (Lead note: keep background-color for e2e token reads and non-image fallback), `box-shadow: var(--glow-cta), inset 0 1px 0 rgba(255,255,255,0.18)`; hover: darken gradient end stops one step (`--color-accent-hover → #3149D6`), no translate; active: `filter: brightness(0.94)` + `transform: scale(0.98)`; focus: global ring; disabled: `background-image: none; background-color: var(--color-surface-muted)`, label `--color-text-muted`, no shadow.
- **Secondary** `.btn-secondary`: fill `--color-surface-muted`, `border: 1px solid var(--color-hairline)`, label `--color-text`; hover (hover:hover) fill `--color-fill-pressed`; active scale 0.98; disabled = primary-disabled mirror (kept).
- **Drag feedback** (`.content.is-dragover`): keep bg `--color-accent-subtle`; ring `::after` becomes `border: 1.5px dashed var(--color-accent-text)`, radius `--radius-lg`, opacity fade 120ms (kept); **add** `.content.is-dragover .empty-state__card { border-color: rgba(143,166,255,0.55); background-color: rgba(18,20,26,0.85); }` (transition background-color/border-color 120ms).
- **Motion**: `rise-in` (fade + 12px up, 320ms `--ease-standard`) once per render on `.empty-state`; reduced-motion: none (extend existing block, §7).

### 4.2 Gallery / analyzing (`.gallery-toolbar`, `.photo-grid`, `.tile`, `.progress-card`)

- **Toolbar**: `max-width: 960px` mobile / 1200px ≥768 (kept); label "Photos" 15/600 `--color-text`; count `--color-text-muted` 13 tabular, 8px gap; "Add more" `.btn-text.btn-text--compact` accent-text (kept).
- **Grid**: `gap: var(--space-8)` (from 4px); columns 3 / 4 (480) / 5 (640) / 7 (768) / 8 (1024) / 9 (1280) — unchanged.
- **Tile**: `.tile__photo` radius-md, `background: var(--color-surface-muted)`, press scale 0.98 120ms (kept). `.results .tile__filename` 13 `--color-text`; gallery filename 13 `--color-text-secondary`. Hover overlay rule kept (pointer only).
- **Score chip pill** (`.chip` + variants): `display:inline-flex; gap:6px; align-items:center; padding: 3px 8px; border-radius: var(--radius-full); background: var(--color-band-*-tint); border: 1px solid rgba(229,72,77,0.30) / rgba(245,165,36,0.30) / rgba(47,191,113,0.30);` label 13/600 band-text token, tabular. `.chip__dot`: 6px, `background: var(--color-band-*)`. **Pending** (`.chip--pending`): `background: var(--color-surface-muted); border-color: var(--color-hairline);` label `--color-text-secondary`, dot 6px `--color-text-muted`; "—" content unchanged.
- **Progress card**: solid `--color-surface`, hairline, radius-lg, `padding: 20px`, shadow-1 + edge highlight, `max-width: 560px`; heading 20/600; status 13 secondary tabular; bar 4px `--color-track` radius-full; fill `--color-accent-text`, scaleX only (kept), plus `box-shadow: 0 0 8px rgba(143,166,255,0.40)`.
- **Motion**: card + tiles `rise-in` 320ms; bar fill `transform 200ms`.

### 4.3 Results (`.results`, `.band*`, `.tile__*`, `.action-bar*`)

- **Subtitle** `.results__subtitle`: 15 secondary, margin-bottom 8.
- **Band header** `.band__header`: gap 12. `.band-chip`: pill — `padding: 4px 10px; border-radius: var(--radius-full); background: var(--color-band-*-tint); border: 1px solid rgba(229,72,77,0.28) / rgba(245,165,36,0.28) / rgba(47,191,113,0.28);` text 11 `--text-micro` **uppercase** 600 band-text, dot 6px `background: currentColor` (kept). `.band-chip--skipped`: neutral — bg `--color-surface-muted`, text secondary, no border. `.band__count`: 13 secondary tabular. `.band__toggle`: kept (13/400 secondary, 44px/32px targets).
- **Tiles**: as §4.2 plus:
  - **Suggested badge** `.tile__suggested`: `background: rgba(10,12,16,0.78)` (blur(8px) with solid fallback), `border: 1px solid var(--color-hairline)`, `border-radius: var(--radius-full)`, `padding: 2px 8px`, caption-2 600 **uppercase** 0.06em, `color: var(--color-text-secondary)`.
  - **Selected** `.tile__photo.is-selected`: `box-shadow: inset 0 0 0 2px var(--color-accent), 0 0 0 1px rgba(0,0,0,0.55);` + `::before` overlay `--color-accent-subtle` (kept) + badge:
  - **Check badge** `.tile__check`: 22×22, `background: var(--color-accent)`, `box-shadow: 0 2px 8px rgba(66,98,255,0.40)`, white check 12px; `check-pop` 200ms (kept).
- **Delete row** `.tile__delete`: kept tertiary (12/400 secondary; 44/32px box); hover `color: var(--color-text)`.
- **Action bar** `.action-bar` (mobile): `position: fixed; inset-inline: 0; bottom: 0;` `background: var(--glass-bar)`; `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))`; fallback `--color-surface`; `border-top: 1px solid var(--color-hairline)`; padding `12px 16px calc(12px + env(safe-area-inset-bottom))`. Row column gap 12; actions wrap right gap 8/12; primary `flex: 1`.
  - **Desktop ≥768 — floating glass pill**: `left: 50%; transform: translateX(-50%); bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px)); width: min(1040px, calc(100vw - 48px)); border: 1px solid var(--color-hairline); border-radius: var(--radius-xl); padding: 12px 16px; box-shadow: var(--shadow-3), inset 0 1px 0 var(--edge-highlight);` (replace full-width border-top treatment). Row → row layout (kept), summary left, actions right, primary `flex: 0 1 auto`.
  - **Button hierarchy**: "Download selected" = primary gradient (§4.1 CTA treatment, 36px on fine pointer, spinner arc white). "Add more / Select keepers / Save HD copies / Delete selected" = **ghost secondary**: `background: transparent; border: 1px solid var(--color-hairline); color: var(--color-text-secondary);` hover: `background: var(--color-hover-overlay); color: var(--color-text);` active scale 0.98; disabled: opacity 0.4. Keep `.action-bar__divider` (separator-strong). Summary 13 tabular secondary. Device note 12 muted (4.72 worst-case on bar glass — verified).
  - **Clearance**: `.results { padding-bottom: calc(var(--action-bar-h, 96px) + var(--space-24)); }` — delete the fixed `128px` desktop override (bug fix §6.3); ResizeObserver keeps feeding real height (works for the pill too).
- **Motion**: single `animation: rise-in var(--duration-slow) var(--ease-standard);` on `.action-bar` (bug fix §6.1); band reveal kept (8px + 50ms stagger ≤6 tiles).

### 4.4 Detail view (`.detail*`)

- **Root** `.detail`: `background: var(--color-scrim)`; add `backdrop-filter: blur(8px)` with `@supports` no-op fallback.
- **Panel** `.detail__panel`: `background: var(--color-stage)`; mobile full-screen sheet (`sheet-rise` 24px, 320ms); desktop `min(960px, 100vw−48px) × min(680px, 100vh−48px)`, radius-lg, shadow-3, `modal-pop` (kept; height changes 640→680).
- **Top bar** `.detail__top`: `background: var(--glass-stage)`; `backdrop-filter: blur(20px) saturate(var(--glass-saturate))` (fallback solid `#101114`); `border-bottom: 1px solid var(--color-hairline)`; height 56; padding 8 16. Done = `.btn-text` **stage-text** (kept). Filename 17/600 stage-text; size 12 stage-text @0.72 (10.32 ✓).
- **Select toggle** `.detail__select`: primary↔secondary swap logic kept; on stage, `.btn-secondary` = fill `--color-surface-muted` + hairline + text (verified vs stage).
- **Stage**: padding 8 16; `is-comparing`/`is-animating` mechanics kept; **stage sizing when HD panel open — see §6.2**.
- **Prev/next** `.detail__nav`: 44×44 (36 fine-pointer, kept); now glass circles: `background: rgba(255,255,255,0.08); border: 1px solid var(--color-hairline);` hover bg 0.14; disabled opacity 0.4. Mobile `.detail__hint-nav` 44px hit box + 32px visual circle (kept); hint text stage-text @0.72.
- **Bottom bar** `.detail__bottom`: same glass treatment as top bar, `border-top: 1px solid var(--color-hairline)`. **Score chip** `.detail__chip`: pill — `padding: 3px 10px; border-radius: var(--radius-full); background: rgba(255,255,255,0.06); border: 1px solid var(--color-hairline);` 13 tabular; dot 6px + text in stage band tokens (kept classes). **Download** `.detail__download`: primary gradient (§4.1) 36px fine-pointer; spinner arc **white**. **Delete** `.detail__delete`: btn-text `color: var(--color-band-blurry-stage)` (kept, 7.23 ✓).
- **Focus**: `.detail :focus-visible` → stage-text ring; `.hd-panel/:focus-visible` → accent-text (kept rules).

### 4.5 Before/after wipe (`.detail__wipe*`, `.detail__after`)

- Line `::before`: 2px `rgba(255,255,255,0.90)` + `box-shadow: 0 0 4px rgba(0,0,0,0.50)`. Handle: 36px `var(--color-on-accent)`, `box-shadow: 0 2px 10px rgba(0,0,0,0.50), 0 0 0 1px rgba(0,0,0,0.20)`; chevrons `var(--color-on-light)` (replace hardcoded `#1C1E21`). Grab strip 44px (kept). Focus ring stage-text (kept).
- **Labels** `.detail__wipe-label`: `background: var(--color-veil)`; `backdrop-filter: blur(8px)` (fallback: token alone — verified 6.59 worst-case); caption-1 600 **uppercase** 0.08em white; positions kept.
- **Motion**: sweep clip-path/left 900ms `--ease-standard` under `.is-animating` only (kept, JS timers unchanged); drag instant; reduced-motion: JS already skips sweep, CSS collapse kept.

### 4.6 HD converter panel (`.hd-panel*`, `.hd-readout*`, `.hd-slider*`, `.choice-row*`, `.hd-status*`)

- **Panel**: **solid** `--color-surface` (not glass — muted text must pass), hairline, radius-lg, `padding: 20px`, `box-shadow: var(--shadow-2), inset 0 1px 0 var(--edge-highlight)`; entrance `hd-fade-in` 200ms (kept).
- Head: title 20/600 + Cancel `.btn-text` compact. **Readout**: mono 15; Original group `--color-text-secondary`, sep muted, Output `--color-text`; window/sizer/line mechanics untouched. **Slider**: row 44px; track 4px — filled portion `--color-accent-text`, rest `--color-track` over panel (replace fill-pressed rest with `--color-track`); **thumb 20px `background: var(--color-accent-text)`, `box-shadow: 0 0 0 1px rgba(0,0,0,0.40)`** (thumb-vs-track = 6.05 ✓; the old accent thumb was <3:1 vs track).
- **Segmented pills** `.choice-row__group`: `background: rgba(255,255,255,0.06); border: 1px solid var(--color-hairline); border-radius: var(--radius-full); padding: 2px; gap: 2px;` label column min-width 88 (kept). **Pill** `.choice-row__pill`: 32px, radius-full, `padding: 0 12px`, transparent bg, 13/600 `--color-text-secondary`. **Checked** (`:checked + pill`): `background: var(--color-surface-muted); border-color: var(--color-accent-text); color: var(--color-accent-text);` (6.8 ✓). **Focus** (`:focus-visible + pill`): ring accent-text (kept rule). Hover (fine): idle pill `color: var(--color-text)`.
- Copy rows `.hd-copy` 13 secondary / `.hd-copy--muted` 12 muted (on solid surface ✓). **Apply** `.hd-panel__apply`: full-width CTA gradient 44px; disabled = muted fill + muted label; busy: label "Upscaling…" + white-arc spinner. **Status** `.hd-status` 13 text; retry btn-text compact. **Preview actions** `.hd-preview__actions`: Keep in review = primary, Download HD copy / Discard = ghost secondary (§4.3); gap 8.

### 4.7 Download format dialog (`.confirm` + `.export-choice*`)

- Root: `var(--color-scrim)` + blur(8px). **Panel** (`.confirm__panel` reused): `background: var(--glass-dialog)`; `backdrop-filter: blur(var(--glass-blur))`; fallback solid `--color-surface-raised`; `border: 1px solid var(--color-hairline)`; radius-lg; `padding: 20px`; `box-shadow: var(--shadow-3)`; `width: min(400px, 100%)`; entrance mobile `confirm-in` (rise 24px), ≥768 `confirm-in-desktop` (scale .98) — kept.
- Title 20/600; note 15 secondary. **Options** `.export-choice` (btn-secondary): full-width, 44px, radius-md, `justify-content: space-between`, `background: transparent; border: 1px solid var(--color-hairline);` label 15/600 `--color-text`; hover fill `--color-hover-overlay`; active scale 0.98; focus ring accent-text. **"last used"** `.export-choice__hint`: mini-pill — `background: var(--color-surface-muted); border-radius: var(--radius-full); padding: 2px 8px;` caption-2 600 `--color-text-secondary` (muted→secondary fix, §6.6). Row gap 8.

### 4.8 Delete confirm, notices, live region (`.confirm*`, `.notice*`, `#live-region`)

- **Confirm panel**: same glass dialog surface as §4.7 (`.btn-delete` verified 5.7 on glass worst-case). Title 20/600; text 15 secondary; inline filename mono 12 `--color-text`; disclosure summary 13 secondary; list mono 12 secondary, hairline left rule `border-left: 1px solid var(--color-hairline); padding-left: 12px` (replaces plain indent). Actions right: Cancel ghost secondary, Delete btn-text red (kept). Focus starts on Cancel; Escape/scrim = cancel (all kept).
- **Notices** `.notice`: solid `--color-surface`, hairline, radius-lg, `padding: 16px 20px`, shadow-1 + edge highlight; icon `#F5A524` (via `--color-band-review`); heading 20/600; body 15 secondary; filelist mono 12 secondary with same left-rule treatment; helper 12 muted; footer right; `notice-in` fade 200ms (kept). Max-width 960 (kept).
- **Live region**: unchanged (visually-hidden, polite).

## 5. Markup changes (each requires an e2e check)

1. **`UploadView.#buildEmptyState`: wrap the card contents in `<div class="empty-state__card">`** — separates the glass-card chrome from the full-height centering layout so the card doesn't stretch on desktop. *e2e risk:* any selector asserting direct children of `.empty-state` must be re-verified; dragover class targets `.content` and new descendant selector only.
2. **`ResultsView` (PhotoDetailView): toggle class `has-hd-panel` on `.detail__panel` when the HD panel opens, and remove it on panel close / photo navigation** (call sites: `#openHDPanel` ~line 722, `#closeHDPanel` ~line 876, `#showPhoto` ~line 1170) — this is the deterministic mechanism for the stage-resize fix in §6.2 (works without `:has()`). *e2e risk:* HD panel open/close/Escape-nesting and wipe-drag flows in `e2e/v2-*` must pass; no accessibility change.
3. **`index.html`: change `<meta name="theme-color">` from `#141517` to `#0A0B0D`** so browser chrome matches the new base. *e2e risk:* v2-r3 asserts `#141517` — update the assertion (see §9).

## 6. Bug fixes (in scope, user-authorized)

1. **`.action-bar` double animation declaration** (two `animation:` lines, the second `notice-in` silently overriding `rise-in`): keep exactly one — `animation: rise-in var(--duration-slow) var(--ease-standard);` — and delete the duplicate. `notice-in` stays defined for `.notice`.
2. **HD panel overlapping the photo stage on desktop**: root cause — `.detail__stage-wrap` is `flex: 1; min-height: 0` (shrinks when the panel is inserted) but `.detail__stage.is-comparing { min-height: 200px }` forces the child to overflow the shrunken wrap and paint over the panel below. Fix: (a) add `overflow: hidden` to `.detail__stage-wrap` unconditionally (paint guard); (b) with the §5.2 `has-hd-panel` class: `.detail__panel.has-hd-panel .detail__stage-wrap { flex: 0 1 auto; min-height: 160px; }`, `.detail__panel.has-hd-panel .detail__stage { min-height: 0; }`, `.detail__panel.has-hd-panel .detail__stage .detail__img { max-height: 220px; }` — stage caps so panel + bottom bar fit inside the 680px modal; the wipe readability floor moves into the wrap's `min-height: 160px` + capped image. Without the class, behavior degrades to today's scroll, never overlap.
3. **`.results` fixed desktop clearance**: delete the `@media (min-width: 768px) { .results { padding-bottom: 128px; } }` override (style.css ~1877); the base `calc(var(--action-bar-h, 96px) + var(--space-24))` tracks the real (shorter, floating) bar via the existing ResizeObserver.
4. **Action-bar button hierarchy**: one gradient primary, ghost secondaries, divider kept (§4.3).
5. **Hardcoded one-off colors tokenized**: wipe handle `#FFFFFF` → `var(--color-on-accent)`; chevrons `#1C1E21` → `var(--color-on-light)`; wipe line → `rgba(255,255,255,0.90)`; labels → `var(--color-veil)`; spinner arc white on accent (`rgba(255,255,255,0.28)` track + `#FFFFFF` top).
6. **`.export-choice__hint` muted-on-surface-muted = 4.05:1** → `--color-text-secondary` inside the mini-pill (7.11 ✓).
7. **Wipe label worst-case 4.29:1** → veil opacity 0.55→**0.66** (`--color-veil`), 6.59 ✓.
8. **Header glass too thin for `.btn-text` accent label** (3.27:1 worst-case) → `--glass-header` opacity 0.82, 5.08 ✓.
9. **`--color-text-muted` failed on raised surfaces** (4.39) → lightened to `#818A97` (4.89 ✓ everywhere it is used).
10. **Slider thumb <3:1 vs track** → thumb switched to `--color-accent-text` + dark contour ring (§4.6).
11. **`rise-in` keyframes defined only inside the reduced-motion block** (style.css ~2321) → move the keyframes to normal scope; entrances actually animate; reduced-motion `animation: none !important` list extended to cover `.empty-state`, `.empty-state__card`, `.action-bar`, `.results`, `.confirm__panel`, `.band--reveal`, `.detail__panel` (existing list kept).
12. **`ResultsView.#formatLine()` (js/ResultsView.js ~1740) drops the chosen format** — `hdOutputSpec(this.#photo.name)` shows the source-default PNG line even with JPEG/WebP selected. Fix: pass the current `this.#format` so the readout matches the selection. (JS bug fix, covered by v2 features e2e.)

### 6.b Known issues OUT of scope (recorded, not fixed now)

- `DeleteConfirmDialog` Tab-trap queries only `button`s — the `<summary>` disclosure is focusable but not trapped (keyboard edge case).
- `ReviewControls` batch dialog focus escapes during conversion when no focusables exist.
- `HDConverter.dispose()` leaves `#modePromise` resolved → worker pool never re-negotiates after "Start over" (falls back to main thread).
These do not block the redesign; file separately if the user wants them fixed.

## 7. Accessibility & responsive checklist

- **Targets ≥44px** (coarse pointers, all widths): `.btn-primary/-secondary` (48 hero), `.btn-text`, `.band__toggle`, `.tile__meta-btn`, `.tile__delete`, `.detail__hint-nav`, `.detail__nav`; fine-pointer density reductions (36/32px) stay gated behind `(min-width: 768px) and (pointer: fine)`; `.btn-hero` excluded (kept).
- **Focus**: single `:focus-visible` system — `outline: 2px solid var(--color-accent-text); outline-offset: 2px`; stage context → stage-text; hd-panel/dialog context → accent-text; segmented pills via `:checked/:focus-visible + pill` pairing. Never removed on any restyled control.
- **Reduced motion**: keep the global 1ms collapse; extend the `animation: none !important` list with `.empty-state`, `.empty-state__card`, and any newly added entrance; the JS short-circuits (wipe sweep, readout slide) are untouched; the spinner collapse is existing accepted behavior.
- **Non-color status cues**: selection = ring + check badge + overlay; pending = "—" glyph + muted dot; verdicts = dot + word + tint; busy = label change + spinner; disabled = fill/label change + `cursor`. Color never sole carrier.
- **Contrast rules baked in**: no muted text on `--glass-stage`/`--glass-dialog`; hover-darkens accent (never lightens) so the white label always ≥4.75; every glass surface ships an `@supports` solid fallback with verified pairs.
- **Responsive**: mobile-first 375 base; breakpoints 480 / 640 / 768 / 1024 / 1280 (grid columns and page-pad per §4.2/§3); action bar: full-width sheet → floating pill at 768; detail: sheet → centered modal at 768; grid wraps at 375 (kept); 320px reflow — 3-column grid ≈93px tiles, pill chips truncate via `min-width: 0`; 200% zoom — all text in rem, targets in px scale with layout; safe-area insets kept on header/action bar/detail bottom.
- **Semantics preserved**: all ARIA (slider, dialogs, live region, `aria-pressed`, band labels, disclosure lists) untouched — v3 is restyle-only plus §5.

## 8. Assumptions & decisions (Lead-approved)

- backdrop-filter support is progressive (fallbacks specified); `has-hd-panel` class (§5.2) approved as the one JS touch beyond markup; `:hover` guards stay `(hover: hover)`.
- **Accent #4262FF** chosen over #4F46E5 and #4353FF — most "premium blue" while passing at 4.75 with margin on hover/press.
- Desktop pill max-width 1040px and the ~220px capped stage height when the HD panel is open — verify against real screenshots after implementation and adjust one token if the stage feels cramped on 768×640 windows.

## 9. E2E updates required (v2-r3-e2e-tester.js)

The R3-2 visual-token assertions hard-code the v0.4 palette. Update the expected values to the v3 palette (same assertions, new constants — do NOT weaken/remove checks): body `rgb(10,11,13)`; accent fill `rgb(66,98,255)`; accent-text `rgb(143,166,255)`; surface-muted `rgb(31,35,43)`; text-muted `rgb(129,138,151)`; text `rgb(245,246,247)`; theme-color `#0A0B0D`; radii `{8,12,16,20,999}` (update the asserted set to the new radius scale; verify what the test actually reads). All other suites (v03, v2-features, v2-r4, phase8) assert structure/text/ARIA only — they must pass UNMODIFIED; if one fails on a class/structure change from §5, fix the implementation first, and only touch the test with Lead approval.
