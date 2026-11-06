# Blurry Photo Cleaner — Design of Record v2 (grey / modern restyle)

## 1. Document meta — what this revision is

| | |
|---|---|
| Artifact | `designs/design-spec-v2.md` — design of record for v0.2.0, Phase R1 of `plans/blurry-photo-cleaner-v2-restyle.md` |
| Status | draft for artifact review (Phase R1 check: cheap, artifact review only) |
| Created | 2026-11-05 |
| Owner | designer |
| Scope | Design revision only. No application code changes here — R2/R3/R4 implement. Plain HTML/CSS/vanilla JS only; no new fonts, no new dependencies (JSZip is specified in §9 and vendored in R4 per the plan). |

**What this file supersedes and what it keeps.** `designs/design-spec.md` (v1) stays the base. This revision replaces exactly:

- v1 **§3** (design tokens — color) in full → replaced by §4 here.
- v1 **§5.2** radius values and **§5.3** shadow/hairline values → replaced by §4.5–4.6 here (rules unchanged, values updated).
- v1 **§6.1** ease value → replaced by §4.6 here (durations and the allowed-motion list unchanged).
- v1 **§3.2's accent-text surface rule**, v1 **§7.3's** touch-target line, and v1 **§9a's** drop-hint line → replaced by §5, §6, §7 here.
- v1 **§9** gains two new feature wireframes (§8, §9 here) for the R4 features.

Everything else in v1 — product direction (§2), typography (§4), spacing (§5.1), layout (§7), components (§8, as amended by §5/§6 here), the five screen wireframes (§9, as amended by §7 here), state machine (§10), progressive enhancement (§11), accessibility (§12, as amended by §6 here), copy rules (§13), prohibitions (§14) — carries forward unchanged into v2.

**Note on the plan's "touches" line.** The plan's Phase R1 lists `designs/design-spec.md` as the touched artifact; the delegation directs the revision to land as this separate v2 file that supersedes parts of v1. This file is that revision — the v1 spec remains checked in as the historical base, and §10 records precisely which of its sections still govern. No conflict in scope, phase, or acceptance criteria.

**Requirement coverage map** (delegation items → sections):

| Delegation requirement | Where |
|---|---|
| 1. Grey/modern token set + recomputed contrast lock | §4 (4.1–4.9) |
| 2. §9a "or drop photos here" one-line sync | §7 |
| 3. `.btn-text` rule by surface, grounded at style.css:299 + 5 override sites | §5 |
| 4. Touch-target rule 44×44 CSS px (Apple HIG) + the four sub-44px sites | §6 |
| 5. Feature wireframes: threshold tuning + ZIP export | §8, §9 |
| 6. Modern direction notes (restrained, no slop, plain CSS) | §3, and §4.5–4.6 for the concrete values |

**How R3/R4 read this file.** R3 (restyle) implements §4's token block verbatim, §5's text-button rule, §6's touch-target values, and §7's copy/behavior sync — with zero behavior change beyond the two rules. R4 (features) implements §8 and §9 against the same tokens; no hex appears in views that is not a token from §4 (plan acceptance).

## 2. References consulted (fetched 2026-11-05)

Search note (same constraint as v1): no general web-search tool was available this session, so reference work was done by fetching known best-in-class sources directly by URL — three primary references, plus the workspace skill catalog as the AI-tell baseline. Queries a searcher would run (`grey neutral dashboard UI mobbin`, `linear vercel github light theme design system colors`, `anti-slop design skill AI design tells`) map onto the three fetched sources and the in-skill reject list below.

- **GitHub Primer — Primitives: Color** — https://primer.style/product/primitives/color/ (fetched 2026-11-05; the `/foundations/color` URL redirects here). The best-in-class example of a modern cool-neutral grey product system in a light theme. Taken from it: the near-black *ink* instead of pure black (`#1F2328` → our `#16191E`), the cool page/canvas grey with white cards (`#F6F8FA`/`#FFFFFF` → our `#F2F3F5`/`#FFFFFF`), one mid-grey muted text role (`#59636E` → our `#57606C`), **one accent doing links, primary fill, focus outline, and checked controls** (`#0969DA` → our single `#2E5C95`), and layered translucent-black shadows rather than opaque grey. Not taken: Primer's solid-color borders (we keep one alpha hairline token — see §4.5) and its two-tone emphasis/semantic system (we keep v1's smaller surface).
- **Apple Human Interface Guidelines — Color** — https://developer.apple.com/design/human-interface-guidelines/color (fetched 2026-11-05; page change log 2025-12-16 / 2025-06-09). Still the source of the band values (increased-contrast variants: red `#E9152D`, orange `#C55300`, green `#008932`; dark-stage variants) and of the grouped-background discipline and inclusive-color rule. Also the citation for keeping a grey scale rather than inventing one-off greys: the system gray table shows iOS's own grouped tiers (systemGray6 light `#F2F2F7` et al.), which v1 leaned on and v2 cools by ≈1–4 blue-channel points to kill the purple cast (§4.1). New relevant guidance carried into §4.2: apply color sparingly, reserve it for primary actions and status, and never let the same color mean two things.
- **Vercel Geist — Colors** — https://vercel.com/geist/colors (fetched 2026-11-05; usage documentation only, values not captured). Taken: the *role structure* of a modern grey scale — a small ladder where each step has one job (component backgrounds / borders / high-contrast fills / secondary text / primary text), borders drawn once, shadows translucent so they blend with the background. v2's ladder in §4.1/§4.5 follows that one-step-one-job shape.
- **`ui-reference` baseline reject list and `unslop` catalog** (workspace skills, loaded this session) — the AI-design tells this restyle must not introduce (the grey wash is itself on the watch list: "low-contrast grey body text" and "one radius everywhere"; §3 and §4 are written against both). R3 runs the `unslop` audit against the grey direction per the plan.

Sources from the plan already verified there and reused here without refetch: Apple HIG Buttons (44×44pt hit region, fetched 2026-11-05) for §6; WCAG 2.5.8 (24×24 CSS px floor, doc updated 2026-05-11) as the absolute floor in §6.

## 3. Modern direction — what "more modern" means here

The plan's Decision Record selects **Route A: a cool-neutral grey system** — near-white background tier, near-black ink, mid-grey secondary text, hairline borders, soft shadows only for depth, ONE muted accent for primary actions; chips/bands become tonal steps with the accent reserved for selection and the primary CTA. Warm greige (Route B) and dark-first (Route C) are rejected by the plan; nothing in this spec drifts toward either — no warm/beige undertones anywhere, and the light appearance stays.

"More modern" is five concrete, restrained moves — each implementable in plain CSS, none decorative:

1. **Ink instead of black; a real grey text ramp.** Primary text drops pure `#000000` for a cool near-black (`#16191E`), and the secondary/muted greys shift from neutral-purple-tinted to cool slate (`#57606C`, `#646E7B`). The page stops being a white page with black text and becomes a grey system with an ink ramp — the single biggest "modern grey" signal, and the one the contrast lock (§4.9) is built around.
2. **Softer, finer surface steps.** v1's fill token was *identical* to the page background (`#F2F2F7` for both). v2 gives the ladder four distinct, closely-spaced cool steps — white cards on `#F2F3F5` page, inputs/secondary fills at `#EEF1F4`, pressed at `#E1E5EA` — so grouping reads through gentle steps instead of jumps (Geist's one-step-one-job structure, §2). The page tier itself stays at iOS grouped-background depth deliberately: every grey text token's worst-case contrast margin is computed against it (§4.9), and "modern" must not be bought by washing out text.
3. **Refined radii and hairlines.** Radii move one soft step up (6/10/16 → **8/12/18**, §4.6) — softer corners without entering pill territory, still three nested sizes, never one radius everywhere. Hairlines and shadows stop being pure-black alpha and take the ink's cool hue (`rgba(22,25,31,…)`), so borders sit *inside* the grey system instead of reading as black rules on it (§4.5).
4. **One muted accent, one token.** The v1 accent pair (`#0088FF` tint / `#1E6EF4` fill+text, plus a derived `#0F4CBD` rescue token and a surface rule to police them) collapses to a single desaturated steel blue `#2E5C95` that passes ≥4.5:1 on *every* surface it can render on, including the translucent header's worst case (§4.2). Fewer tokens, no per-surface branching, calmer color — the accent covers even less of the screen than in v1, and the photos stay the only saturated thing on it.
5. **A slightly softer motion settle.** The single easing curve softens from `cubic-bezier(0.22, 1, 0.36, 1)` to `cubic-bezier(0.25, 1, 0.5, 1)` — the same fast-attack, gently-decelerating Apple feel with a less abrupt stop. Durations, the allowed-motion list, and the reduced-motion collapse are unchanged (§4.6). No new motion is added; nothing loops, nothing bounces.

**What does not change** (the restraint contract, per v1 §2 and §14, carried forward): calm and unhurried; the chrome disappears behind the photos; one accent; no glows, no gradients anywhere, no colored shadows, no glass beyond the header's standard material, no emoji, no decorative motion, no deletion affordances. The `unslop` watch-signals for grey systems are explicitly designed against: body/muted greys stay ≥4.5:1 on their real composites (§4.9 — no low-contrast grey body text), the accent — not grey-on-grey layering — carries hierarchy, and radii remain nested per element type (§4.6).

**Named styles** (v1 §2 vocabulary, updated for the shared words spec and implementation now use):

- *Aesthetic*: cool-neutral grey system — Apple-restrained, grouped-inset structure, ink-on-grey with one muted accent (successor to "iOS system style").
- *Layout style*: unchanged from v1 — single-column app shell, sticky translucent header, 960px/1200px content caps, bottom action bar.
- *Interaction style*: unchanged from v1 — direct manipulation on tiles, sheet/modal detail review, inline notice cards, never modal alerts for recoverable problems.

## 4. Grey/modern token set — full replacement color system

Named values; CSS custom properties keep the v1 `--color-*` names unless §4.8 marks a token retired. All values are light-appearance (v1 §2 dark-theme note carries: tokens are named semantically so a dark variant is a later swap — plan backlog item 1). Contrast ratios are computed per WCAG 2.x (method in §4.9) against each token's *real* composites — the surfaces it actually renders on in this app — not against an idealized white.

### 4.1 Surfaces and text — the cool-neutral ladder

The ladder has four surface steps and three text steps. Each step has one job (§2, Geist structure); adjacent steps are close enough to read as one material, far enough to group.

| Token | Value | Role (where it actually renders) | Contrast on its real composites |
|---|---|---|---|
| `--color-bg` | `#F2F3F5` | Page background — the grouped background behind tiles, band sections, toolbar, empty state (was `#F2F2F7`; blue channel −2, red ±0, green +1: the iOS purple cast removed, grouped-background depth kept) | verification surface — see the text rows below |
| `--color-surface` | `#FFFFFF` | Cards, notice cards, sheets, modals, action bar, the threshold panel (§8), tiles' meta area (unchanged from v1) | — |
| `--color-surface-muted` | `#EEF1F4` | Inputs and value inputs (§8), secondary-button fill, hover rows inside white surfaces, skipped-chip fill (was `#F2F2F7` — identical to the page background; now its own step one below it) | — |
| `--color-fill-pressed` | `#E1E5EA` | Pressed control fill; pending-chip dot; unfilled slider track (was `#E5E5EA`, cooled) | — |
| `--color-text` | `#16191E` | Primary labels and body text (was `#000000`) | 17.62 on white · 15.87 on bg · 15.54 on surface-muted · 13.92 on fill-pressed · 12.48 on header worst case |
| `--color-text-secondary` | `#57606C` | Supporting text: explanations, band counts, detail captions, skipped chip (was `#636366`; cooler and darker) | 6.37 on white · 5.74 on bg · 5.62 on surface-muted |
| `--color-text-muted` | `#646E7B` | Meta and captions only: file sizes, timestamps, privacy line, drop hint (pointer devices), pending "—", ZIP disclosure line (was `#6E6E73`; cooler, keeps ≥4.5 on every composite incl. surface-muted) | 5.17 on white · 4.66 on bg · 4.56 on surface-muted |

The text ramp is the plan's red-team mitigation made concrete: v1's muted value measured ≈4.5:1 on the grouped background with almost no margin; `#646E7B` holds **4.66:1 on the new bg and 4.56:1 even on the surface-muted fill**, so no grey text token ships near the line on any surface it renders on (full table in §4.9).

Header translucency is unchanged — `rgba(255,255,255,0.85)` + `backdrop-filter: blur(20px)` + bottom hairline. Its worst-case composite (85% white over pure black content scrolled beneath) is `rgb(217,217,217)` ≈ `#D9D9D9`; every token that renders in the header is verified against that composite in §4.9 (ink 12.48, accent 4.83).

### 4.2 Accent — one muted accent, one token

| Token | Value | Role | Notes |
|---|---|---|---|
| `--color-accent` | `#2E5C95` | **Everything the v1 accent family did**: primary button fill; text buttons on every surface (§5); links; selection ring; check-badge fill; focus ring on light surfaces; drop-zone drag-over border; progress-bar fill; filled slider track (§8) | HSL ≈ 213°, 53%, 38% — v1's blue family (206–219°) with chroma cut roughly in half. White label on it 6.82:1; as text on white 6.82:1; on bg 6.14:1; on surface-muted 6.01:1; on the header worst case 4.83:1 — ≥4.5:1 everywhere, so **one token does fill and text on every surface** |
| `--color-accent-press` | `#275084` | Primary button pressed fill (was `#1A63DB`) | white label on it 8.18:1; derived ≈8% darker than the accent |
| `--color-accent-subtle` | `rgba(46,92,149,0.10)` | Selected-tile overlay, drag-over drop-zone fill (was `rgba(0,136,255,0.10)`) | effective `#EAEEF4` on white, `#DEE4EB` on bg; decorative — meaning carried by the ring + checkmark, never by tint alone |
| *(retired)* | — | `--color-accent` `#0088FF`, `--color-accent-strong` `#1E6EF4`, `--color-accent-text` `#0F4CBD` — all three v1 tokens are **replaced by the single `--color-accent` above** | v1 §3.2's accent-text surface rule ("accent-strong on white, accent-text on non-white") is **deleted**: `#2E5C95` clears 4.5:1 on both, so the rule has nothing left to police. R3 removes the branch, not just its values |

**Why `#2E5C95` — the "muted, your call" justification.** The plan constrains the accent to one, muted, dialed down from v1's `#1E6EF4`. Four reasons for this exact value:

1. **It closes the v1 token trap by construction.** v1 needed two accent tokens plus a derived rescue token plus a written surface rule because `#1E6EF4` measured 4.10:1 on the grouped background. A muted accent dark enough to pass ≥4.5:1 on the *worst* composite it can ever render on (the header at `#D9D9D9`, 4.83:1) makes the two-token split, the surface rule, and all five per-view override sites unnecessary (§5). One token, zero branching — the trap stays closed because there is nothing to override.
2. **It is genuinely "dialed down", not recolored.** Same blue family as v1 (213° inside v1's 206–219° range — selection/primary stays "the blue"), saturation ≈53% vs ≈90%, lightness 38% vs 54%. Against the grey ladder it reads as a calm steel blue, not a vivid system blue — the accent covers less visual area and the photos remain the only saturated color on screen (v1 §2's "Moments" rule, now stronger).
3. **It strengthens every pair it appears in.** White-on-fill goes 4.6 → 6.82:1; accent-as-text on the grouped background goes 4.10 → 6.14:1; the focus ring (non-text, ≥3:1 required) holds ≥4.83:1 on every light surface. The dial-down *improves* the contrast profile rather than spending it.
4. **It is restrained by reference.** This is the same one-accent-does-everything shape as Primer's `#0969DA` (links, primary, focus, checked) — a proven modern-grey pattern — muted one step further to suit a photo tool whose chrome must stay quiet (§2).

Color-job rules carry from v1 §3.5 unchanged, with the accent's job list now: selection, primary action, focus, drag-over, progress — and nothing else. HIG's new color-sparingly guidance (fetched 2026-11-05) lands on the same side: accent on the primary control's fill only, never on multiple controls.

### 4.3 Band colors — semantic, re-certified on the new greys

The three verdict colors keep their HIG increased-contrast values (v1 source, re-fetched 2026-11-05: red/orange/green "increased contrast (light)"). **Deliberate decision: the values do not move** — verdict colors must stay recognizable across versions, they are already desaturated-by-design accessible variants, and every pair they appear in re-certifies ≥4.5:1 against the new grey composites below. "Harmonized with the grey system" here means: re-verified on the new page background and tint composites, the on-tint text rule restated without exception, and the stage variants re-verified on the new darker stage (§4.4). Tints stay 10% alpha.

| Token | Base text value (white surfaces) | Tint value (chips, 10% fills) | Meaning |
|---|---|---|---|
| `--color-band-blurry` | `#E9152D` | `rgba(233,21,45,0.10)` | Low Laplacian-variance score — likely blurry |
| `--color-band-review` | `#C55300` | `rgba(197,83,0,0.10)` | Middle band — the user decides |
| `--color-band-sharp` | `#008932` | `rgba(0,137,50,0.10)` | High score — likely sharp |

On-tint text variants (values unchanged from v1; contrast recomputed on the v2 composites):

| Token | Value | Computed contrast (v2 composites) |
|---|---|---|
| `--color-band-blurry-text` | `#BB1125` | 5.56 on blurry tint over white `rgb(253,232,234)` · **5.02 on blurry tint over bg `rgb(241,221,225)` (worst case)** · 5.87 on bg · 6.52 on white |
| `--color-band-review-text` | `#A34400` | 5.44 on review tint over white `rgb(249,238,230)` · **4.92 on review tint over bg `rgb(238,227,220)` (worst case)** · 5.59 on bg · 6.21 on white |
| `--color-band-sharp-text` | `#007029` | 5.48 on sharp tint over white `rgb(230,243,234)` · **4.96 on sharp tint over bg `rgb(218,232,226)` (worst case)** · 5.65 on bg · 6.27 on white |

Rules (v1 §3.3, restated for the grey system — unchanged in behavior):

- Band **text** on a tint or the grouped background always uses `--color-band-*-text`. Band chips (`tint` fill on the page background) and tile score chips (text directly on the page background, no tint) both take the `*-text` variants; the base values stay on white surfaces (notice/empty-state warning icons) and non-text uses (chip dots keep the base color; band-chip dots use `currentColor`, i.e. the chip's `*-text`).
- The worst case for every band chip is its 10% tint over the page background (`#F2F3F5`) — darker than the same tint over white — and that is the number the table above certifies. Margins are 4.92–5.02:1, the same ≈0.4–0.5 margin v1 shipped on its composites.
- Inclusive color (HIG, unchanged): band color is never the only signal — headings, counts, chips with visible numbers, and the score on every tile carry the verdict in text.
- New in v2 (§8): the threshold tuning UI uses the band *text* values only in the legend's band words; the tuning panel itself is neutral grey — thresholds are settings, not verdicts, so the panel carries no band tints.

### 4.4 Media stage and overlays

The detail stage moves into the ink family — a cooler, slightly darker neutral than v1's `#1C1C1E`, so photos sit on the same temperature as the rest of the system (the "updated stage-dark detail tokens" item):

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--color-stage` | `#14171C` | Photo detail stage behind large images (was `#1C1C1E`) | verification surface for the rows below |
| `--color-stage-text` | `#FFFFFF` | Labels on the stage; focus ring on the stage and on dark imagery (v1 §12 rule carried) | 17.96 on stage |
| `--color-band-blurry-stage` | `#FF4245` | Stage chip, blurry (value unchanged) | 5.23 on the new stage (was ≥4.9 on `#1C1C1E`) |
| `--color-band-review-stage` | `#FFA056` | Stage chip, needs review (value unchanged) | 8.91 on the new stage |
| `--color-band-sharp-stage` | `#4AD968` | Stage chip, sharp (value unchanged) | 9.77 on the new stage |
| `--color-scrim` | `rgba(11,14,19,0.44)` | Modal scrim behind the desktop detail modal (was `rgba(0,0,0,0.44)`; same strength, ink-cool hue) | decorative — content over it is the white modal |

The darker stage *raises* every stage text ratio (white 17.96; band variants 5.23–9.77), so the v1 stage tokens re-certify with more margin than they had — no value change needed there either.

### 4.5 Hairlines, shadows, surface steps — depth restated for grey surfaces

v1's depth rules (§5.3) carry: hairlines are the default structure, two shadows only, never colored shadows or gradients. What changes is the *color* of the depth system — borders and shadows take the ink's cool hue instead of pure black, so they belong to the grey ladder rather than sitting on it as black rules:

| Token | v1 | v2 | Notes |
|---|---|---|---|
| `--color-hairline` | `rgba(0,0,0,0.08)` | `rgba(22,25,31,0.10)` | Cards, sheets, drop zone, list separators (16px inset). One alpha token still serves every surface (white, bg, translucent header) — that is why alpha beats Primer's solid `#D1D9E0` here; one token, no per-surface branching. Composites: `rgb(232,232,232)` on white, `rgb(220,221,224)` on bg — decorative structure, same stance as v1 |
| `--color-separator-strong` | `rgba(0,0,0,0.15)` | `rgba(22,25,31,0.16)` | Input and value-input borders, opaque dividers. Composite `rgb(218,218,219)` on white |
| `--color-hover-overlay` | `rgba(0,0,0,0.04)` | `rgba(22,25,31,0.05)` | Desktop hover veil on photo tiles (pointer only) |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(15,18,24,0.06)` | Resting cards, tiles' meta area |
| `--shadow-floating` | `0 8px 24px rgba(0,0,0,0.06)` | `0 8px 24px rgba(15,18,24,0.08)` | Bottom action bar and the desktop modal only (v1 rule carried) |

Progress track (v1: `rgba(0,0,0,0.06)` on the white card) becomes `rgba(22,25,31,0.06)` — composite `rgb(241,241,242)` on white; accent fill against it 6.04:1 (non-text ≥3:1 ✓).

Surface steps, restated as the rule R3 implements: space between adjacent steps stays *small* — white `#FFFFFF` → page `#F2F3F5` → fill `#EEF1F4` → pressed `#E1E5EA` — but the ladder is deliberately **not even**: relative-luminance step ratios are **1.116 / 1.022 / 1.124** (1.110 / 1.021 / 1.116 on the WCAG-contrast scale used in §4.9 — same shape). The bg→fill step is intentionally the tightest (~2%): `#EEF1F4` reads as the page material slightly inset, so inputs and secondary fills group with the page instead of floating as separate planes, and hierarchy on that seam comes from hairlines and borders (table above), not from step size. The two steps that must read as separation — page under white cards, pressed under resting — hold ≈1.12. Two surfaces may never be visually identical (v1 had fill == page bg; fill's own value plus the `--color-separator-strong` borders on inputs are what keep it a distinct step now); if two elements share a value they are the same surface. Header translucency, safe-area handling, and "never gradient fills on any surface" all carry from v1 §5.3 unchanged.

### 4.6 Radius and motion feel

**Radii** (v1 §5.2 nested rule unchanged — inner = outer − padding, floor 4; three sizes + full, never one radius everywhere):

| Token | v1 | v2 | Applied to |
|---|---|---|---|
| `--radius-sm` | 6px | **8px** | Small controls, band chips, score chips, inline badges |
| `--radius-md` | 10px | **12px** | Buttons, inputs, photo tiles, sliders |
| `--radius-lg` | 16px | **18px** | Cards, drop zone, notice cards, threshold panel, sheets, modals |
| `--radius-full` | 999px | 999px (unchanged) | Selection checkmark badge, progress bar, pending-chip dot, avatar-like circles only |

One soft step up per size — corners read gentler at every scale without entering pill territory, and the nested rule keeps chips inside cards visibly tighter than their containers (the unslop "one radius everywhere" tell stays designed-out).

**Motion feel** — one token changes:

| Token | v1 | v2 |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | `cubic-bezier(0.25, 1, 0.5, 1)` — same fast-attack decel, softer settle |

`--duration-fast` 120ms, `--duration-standard` 200ms, `--duration-slow` 320ms, `--duration-stagger` 50ms — unchanged. The allowed-motion list (v1 §6.2), the transitioned-properties whitelist, the forbidden-motion list (§6.3), and the reduced-motion collapse are unchanged; new R4 controls (sliders, ZIP states) may use only motions already on that list. No new motion is introduced by v2 — the restyle changes how existing transitions *settle*, not how much things move.

### 4.7 Drop-in token block

The complete color/depth/motion token set for R3, named exactly as R3 declares them. Typography (§4.1 v1) and spacing (§5.1 v1) tokens are unchanged from v1 and are not repeated.

```css
:root {
  /* §4.1 — surfaces (the cool-neutral ladder) */
  --color-bg: #F2F3F5;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF1F4;
  --color-fill-pressed: #E1E5EA;

  /* §4.1 — text ramp */
  --color-text: #16191E;
  --color-text-secondary: #57606C;
  --color-text-muted: #646E7B;

  /* §4.5 — structure */
  --color-hairline: rgba(22, 25, 31, 0.10);
  --color-separator-strong: rgba(22, 25, 31, 0.16);
  --color-hover-overlay: rgba(22, 25, 31, 0.05);
  --color-track: rgba(22, 25, 31, 0.06);          /* progress-bar track (was inline) */

  /* §4.2 — accent: ONE token does fill + text on every surface */
  --color-accent: #2E5C95;
  --color-accent-hover: #366399;                  /* primary fill on hover (pointer devices) — was inline #2774F4, §4.8 literal map */
  --color-accent-press: #275084;
  --color-accent-subtle: rgba(46, 92, 149, 0.10);

  /* §4.3 — bands (values unchanged from v1; re-certified on v2 composites) */
  --color-band-blurry: #E9152D;
  --color-band-review: #C55300;
  --color-band-sharp: #008932;
  --color-band-blurry-text: #BB1125;
  --color-band-review-text: #A34400;
  --color-band-sharp-text: #007029;
  --color-band-blurry-tint: rgba(233, 21, 45, 0.10);
  --color-band-review-tint: rgba(197, 83, 0, 0.10);
  --color-band-sharp-tint: rgba(0, 137, 50, 0.10);

  /* §4.4 — media stage and overlays */
  --color-stage: #14171C;
  --color-stage-text: #FFFFFF;
  --color-scrim: rgba(11, 14, 19, 0.44);
  --color-band-blurry-stage: #FF4245;
  --color-band-review-stage: #FFA056;
  --color-band-sharp-stage: #4AD968;

  /* §4.5 — depth */
  --shadow-card: 0 1px 2px rgba(15, 18, 24, 0.06);
  --shadow-floating: 0 8px 24px rgba(15, 18, 24, 0.08);

  /* §4.6 — radius (nested rule unchanged: inner = outer − padding, floor 4) */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-full: 999px;

  /* §4.6 — motion (single curve, softened settle; durations unchanged) */
  --ease-standard: cubic-bezier(0.25, 1, 0.5, 1);
}
```

### 4.8 v1 → v2 token successor map

Plan acceptance: *every v1 token has a grey/modern successor named in the spec.*

| v1 token (design-spec.md §3, §5, §6) | v2 successor |
|---|---|
| `--color-bg` `#F2F2F7` | `--color-bg` `#F2F3F5` |
| `--color-surface` `#FFFFFF` | `--color-surface` `#FFFFFF` (unchanged) |
| `--color-surface-muted` `#F2F2F7` | `--color-surface-muted` `#EEF1F4` (own step, no longer equal to bg) |
| `--color-fill-pressed` `#E5E5EA` | `--color-fill-pressed` `#E1E5EA` |
| `--color-text` `#000000` | `--color-text` `#16191E` |
| `--color-text-secondary` `#636366` | `--color-text-secondary` `#57606C` |
| `--color-text-muted` `#6E6E73` | `--color-text-muted` `#646E7B` |
| `--color-hairline` `rgba(0,0,0,0.08)` | `--color-hairline` `rgba(22,25,31,0.10)` |
| `--color-separator-strong` `rgba(0,0,0,0.15)` | `--color-separator-strong` `rgba(22,25,31,0.16)` |
| `--color-hover-overlay` `rgba(0,0,0,0.04)` | `--color-hover-overlay` `rgba(22,25,31,0.05)` |
| `--color-accent` `#0088FF` (non-text tint) | merged → `--color-accent` `#2E5C95` (one token, all accent roles) |
| `--color-accent-strong` `#1E6EF4` (fill/text) | merged → `--color-accent` `#2E5C95` |
| `--color-accent-text` `#0F4CBD` (rescue token) | **retired — no successor**: `#2E5C95` passes ≥4.5:1 on every surface incl. the header worst case; v1 §3.2's surface rule is deleted (§5) |
| `--color-accent-subtle` `rgba(0,136,255,0.10)` | `--color-accent-subtle` `rgba(46,92,149,0.10)` |
| `--color-accent-press` `#1A63DB` | `--color-accent-press` `#275084` |
| `--color-band-blurry/review/sharp` (+ tints) | unchanged values, re-certified (§4.3) |
| `--color-band-blurry/review/sharp-text` | unchanged values, re-certified on v2 composites (§4.3) |
| `--color-stage` `#1C1C1E` | `--color-stage` `#14171C` |
| `--color-stage-text` `#FFFFFF` | unchanged |
| `--color-band-*-stage` (3 tokens) | unchanged values, re-certified on `#14171C` (§4.4) |
| `--color-scrim` `rgba(0,0,0,0.44)` | `--color-scrim` `rgba(11,14,19,0.44)` |
| progress track (inline `rgba(0,0,0,0.06)`, v1 §8.2) | **new named token** `--color-track` `rgba(22,25,31,0.06)` (no inline values — plan: no hex in views that isn't a token) |
| `--radius-sm/md/lg` 6/10/16px | **8/12/18px** (`--radius-full` unchanged) |
| `--shadow-card` / `--shadow-floating` | hue-matched `rgba(15,18,24,…)` at 0.06/0.08 (§4.5) |
| `--ease-standard` `cubic-bezier(0.22,1,0.36,1)` | `cubic-bezier(0.25,1,0.5,1)` (§4.6) |
| type scale (§4.2), spacing scale (§5.1), all durations | **unchanged** — v1 continues to govern |

**Non-token hex literals in v1 app source** (plan AC: "no non-token hex in views unmapped" — the audit's three unmapped literals, all mapped here. The remaining literals are already covered: white `#FFFFFF` strokes in the inline icon set and the favicon circle, `index.html:50` and `assets/mark.svg:3`, map to the unchanged `--color-surface` row above; the `#1E6EF4`/`#0F4CBD` mentions at `style.css:265` and `:333` are comments, not rendered values):

| v1 literal (site) | v2 successor |
|---|---|
| `.btn-primary:hover` fill `#2774F4` (`css/style.css:266`, inside `@media (hover: hover)`) | **new named token** `--color-accent-hover` `#366399` — the accent mixed 4% toward white, the exact mechanic v1's hover used (`#1E6EF4` + 4% white = `#2774F4`; here rgb(46,92,149) + 4% white → rgb(54,99,153)). White label on it: linearized R 0.03689, G 0.12477, B 0.31855 → L = 0.2126·0.03689 + 0.7152·0.12477 + 0.0722·0.31855 = 0.12007; ratio = 1.05 / 0.17007 = **6.17:1** ≥ 4.5 ✓ (§4.9 pair 15a; v1's literal measured 4.29:1 — below the lock). Primary-label states: rest 6.82 / hover 6.17 / press 8.18 |
| `<meta name="theme-color" content="#F2F2F7">` (`index.html:7`) | `#F2F3F5` — `--color-bg`'s exact value (the attribute cannot take `var()`, so R3 writes the token's literal; the browser-chrome tint follows the new page background) |
| favicon rounded-square fill `#1E6EF4` (`assets/mark.svg:2`) | `#2E5C95` — `--color-accent`'s exact value (SVG `fill` cannot take `var()`, so R3 writes the token's literal; the mark stays "the blue", the one accent) |

**R3 rename note — the 14 accent-token consumer sites in `css/style.css`** (so no `var()` reference breaks when the tokens merge): `--color-accent-strong` at `:164` (link color), `:189` (focus outline), `:259` (primary fill), `:311` (.btn-text), `:656` (.notice__summary), `:875` (selection ring), `:895` (check badge) → all become `var(--color-accent)`; `--color-accent-text` at `:338` (.btn-text override, deleted per §5) and `:821` (.band__toggle color) → become `var(--color-accent)`; `--color-accent` at `:378` (drop-zone border) and `:741` (progress fill) keep the name; `--color-accent-press` (`:271`) and `--color-accent-subtle` (`:369`, `:882`) keep their names with new values. The `.btn-primary:hover` literal at `:266` is not a `var()` site — it becomes `var(--color-accent-hover)` per the literal map above.

### 4.9 Contrast lock — the v2 pair table

This is the successor of the v1 31-pair lock: every text/background pair the v2 system can render, computed, plus the non-text pairs. Thresholds: **every text pair ≥4.5:1** (WCAG 1.4.3 — the v1 rule "nothing ships on the large-text spacing exception" carries, so even 34px titles certify at 4.5), **every non-text/UI pair ≥3:1** (1.4.11). Disabled controls are exempt under 1.4.3 ("inactive UI components") and are computed anyway.

**Method.** WCAG 2.x relative luminance: linearize each sRGB channel (`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`, channel = 8-bit/255), `L = 0.2126R + 0.7152G + 0.0722B`; ratio `= (L_light + 0.05) / (L_dark + 0.05)`. Alpha colors are composited over their real backdrop per channel before computing.

**Worked example** — `--color-text-muted` `#646E7B` on `--color-bg` `#F2F3F5`:
linearized channels of `#646E7B` → R 0.12747, G 0.15593, B 0.19803 → `L = 0.2126·0.12747 + 0.7152·0.15593 + 0.0722·0.19803 = 0.1529`;
linearized `#F2F3F5` → R 0.88793, G 0.89624, B 0.91315 → `L = 0.8957`;
ratio = `(0.8957 + 0.05) / (0.1529 + 0.05) = 0.9457 / 0.2029 = 4.66` ✓. (Same method, all rows below; computed by script, rounded to 2 decimals.)

**Composites used below** (alpha over backdrop, per channel):

- Header worst case: `0.85·255 + 0.15·0 = 216.75 → 217` → `rgb(217,217,217)` `#D9D9D9` (85% white header over pure-black content scrolled beneath — the darkest possible backdrop; lighter content only raises the ratios).
- Band tints (10% band color over backdrop): blurry over white `rgb(253,232,234)`, over bg `rgb(241,221,225)`; review over white `rgb(249,238,230)`, over bg `rgb(238,227,220)`; sharp over white `rgb(230,243,234)`, over bg `rgb(218,232,226)`.
- Accent-subtle over white `rgb(234,239,244)`; progress track over white `rgb(241,241,242)`.

**Text pairs (≥4.5:1):**

| # | Foreground | Background / composite | Ratio | Renders as |
|---|---|---|---|---|
| 1 | `--color-text` | `--color-surface` | 17.62 | body on cards, notices, panels |
| 2 | `--color-text` | `--color-bg` | 15.87 | empty-state body |
| 3 | `--color-text` | `--color-surface-muted` | 15.54 | input values, secondary-button labels |
| 4 | `--color-text` | `--color-fill-pressed` | 13.92 | pressed secondary-button label |
| 5 | `--color-text` | header worst `#D9D9D9` | 12.48 | header title over scrolled content |
| 6 | `--color-text-secondary` | `--color-surface` | 6.37 | notice body, detail captions |
| 7 | `--color-text-secondary` | `--color-bg` | 5.74 | band counts, empty-state explanation |
| 8 | `--color-text-secondary` | `--color-surface-muted` | 5.62 | skipped chip, input helper text (§8) |
| 9 | `--color-text-muted` | `--color-surface` | 5.17 | notice helper, captions on cards |
| 10 | `--color-text-muted` | `--color-bg` | 4.66 | privacy line, drop hint, tile sizes, pending "—" |
| 11 | `--color-text-muted` | `--color-surface-muted` | 4.56 | disabled labels (WCAG-exempt; passes anyway) |
| 12 | `--color-accent` | `--color-surface` | 6.82 | text buttons on cards: "Dismiss", notice summary (§5) |
| 13 | `--color-accent` | `--color-bg` | 6.14 | text buttons on bg: "Start over", "Add more", "Select all", "Tune thresholds" (§8) |
| 14 | `--color-accent` | header worst `#D9D9D9` | 4.83 | "Start over" over scrolled content — **the pair that forced v1's rescue token; now passes with margin** |
| 15 | `#FFFFFF` | `--color-accent` | 6.82 | primary button label (v1: ≈4.6) |
| 15a | `#FFFFFF` | `--color-accent-hover` | 6.17 | primary-button hover label (pointer devices only, `@media (hover: hover)`) — derivation in §4.8's literal map |
| 16 | `#FFFFFF` | `--color-accent-press` | 8.18 | pressed primary label |
| 17 | `--color-band-blurry-text` | blurry tint over white | 5.56 | (chip-on-white case) |
| 18 | `--color-band-blurry-text` | blurry tint over bg | **5.02** | band chip (worst case) |
| 19 | `--color-band-blurry-text` | `--color-bg` | 5.87 | tile score chip |
| 20 | `--color-band-blurry-text` | `--color-surface` | 6.52 | reserved (icons) |
| 21 | `--color-band-review-text` | review tint over white | 5.44 | (chip-on-white case) |
| 22 | `--color-band-review-text` | review tint over bg | **4.92** | band chip (worst case) |
| 23 | `--color-band-review-text` | `--color-bg` | 5.59 | tile score chip |
| 24 | `--color-band-review-text` | `--color-surface` | 6.21 | warning icons on notice cards |
| 25 | `--color-band-sharp-text` | sharp tint over white | 5.48 | (chip-on-white case) |
| 26 | `--color-band-sharp-text` | sharp tint over bg | **4.96** | band chip (worst case) |
| 27 | `--color-band-sharp-text` | `--color-bg` | 5.65 | tile score chip |
| 28 | `--color-band-sharp-text` | `--color-surface` | 6.27 | reserved (icons) |
| 29 | `--color-stage-text` | `--color-stage` | 17.96 | "Done"/"Select", focus ring on stage |
| 30 | `--color-band-blurry-stage` | `--color-stage` | 5.23 | stage chip, blurry |
| 31 | `--color-band-review-stage` | `--color-stage` | 8.91 | stage chip, needs review |
| 32 | `--color-band-sharp-stage` | `--color-stage` | 9.77 | stage chip, sharp |

**Non-text/UI pairs (≥3:1):**

| # | Element | Against | Ratio | Notes |
|---|---|---|---|---|
| 33 | accent (focus ring, selection ring, drag-over border) | `--color-surface` | 6.82 | ✓ |
| 34 | accent (same) | `--color-bg` | 6.14 | ✓ |
| 35 | accent (same) | `--color-surface-muted` | 6.01 | ✓ |
| 36 | focus ring on `--color-stage` / dark imagery | — | — | uses `--color-stage-text` (17.96 on stage) — v1 §12 rule carried, accent never rings on dark |
| 37 | band dots (base values) | `--color-surface` | 4.56 / 4.55 / 4.54 | blurry / review / sharp ✓ |
| 38 | band dots (base values) | `--color-bg` | 4.10 / 4.10 / 4.09 | ✓ |
| 39 | accent progress fill | `--color-track` composite | 6.04 | ✓ |
| 40 | accent slider filled track | `--color-fill-pressed` (unfilled) | 5.39 | ✓ (§8) |
| 41 | accent drag-over border | accent-subtle over white | 5.89 | ✓ (drop-zone active state) |
| 42 | selection ring over arbitrary photo imagery | — | — | not guaranteed against arbitrary imagery; selection meaning is carried by the check badge (white/accent 6.82) + subtle overlay — v1 stance carried |
| 43 | hairlines / separators | — | — | decorative (v1 stance carried); composites in §4.5 |
| 44 | pending-chip dot `--color-fill-pressed` | `--color-bg` | — | decorative; state carried by the "—" text (pair 10) |

**Result:** the full v2 lock passes — all 33 text pairs at ≥4.5:1 and the non-text set at ≥3:1. The table's true minimum is **pair 11 (muted on surface-muted) at 4.56** — a disabled-labels-only pair, exempt under SC 1.4.3 (inactive UI components; preamble above) and computed anyway, where it passes. Among **active** text the minimum margin is **pair 10 (muted on bg) at 4.66**, and the tightest band-chip worst case is pair 22 at 4.92. R3's e2e contrast suite therefore asserts 4.5:1 across all rows with **4.66:1 as the floor for active text** — pair 11 is certified at its own 4.56 and is never held to the active-text floor. The plan's red-team flip condition ("darken the ink/secondary greys rather than adding color") was **not** needed — the grey ramp clears 4.5:1 on every real composite without darkening past the modern feel. R3's e2e re-runs this table as the contrast regression suite (plan R3: "v1's 31 locked pairs + all new pairs" — this table is that union, restated for the new tokens).

## 5. Rule change A — text-button color by surface (the `.btn-text` trap closed)

**The v1 trap, grounded.** The text-button component is defined once at `css/style.css:299` — `.btn-text` with `color: var(--color-accent-strong)` at `:311` and the 44px touch base at `:302` — and then bypassed at five per-view override sites:

| Site | Override | Why it existed |
|---|---|---|
| `style.css:336` | `.app-header .btn-text { color: var(--color-accent-text) }` | v1 F-1 fix: `#1E6EF4` measured 4.10:1 on the grouped background and 4.16:1 over the scrolled-under header — below 4.5:1 — so non-white surfaces needed the darker rescue token |
| `style.css:337` | `.gallery-toolbar .btn-text { … }` (same rule as :336) | same reason |
| `style.css:510` | `.gallery-toolbar .btn-text { min-height: 44px }` | re-asserts what the base already says |
| `style.css:693` | `.notice__footer .btn-text { min-height: 44px }` | same re-assert |
| `style.css:1339` | `.gallery-toolbar .btn-text, .notice__summary { min-height: 32px }` (≥768px block) | pointer-density size — and note `.notice__summary` (`style.css:649–658`, accent-colored at `:656`) is a *second* component re-implementing the text-button pattern beside it |

The color branch of this trap is **closed by the token change itself**: v2 has one accent (`#2E5C95`, §4.2) that passes ≥4.5:1 on every surface a text button renders on — white cards 6.82, grouped background 6.14, translucent-header worst case `#D9D9D9` 4.83 (§4.9 pairs 12–14).

**The v2 text-button color rule (replaces v1 §3.2's surface rule and v1 §8.1's text-button row):**

> A text button's label is always `--color-accent`, on every surface — white cards, the grouped background, and the translucent header. There is no surface-dependent variant, no exception list, and no per-view color override. Surface decides nothing; the component decides.

**R3 consolidation shape** (plan Finding 2: "consolidate these into token variants so button-text styling has one source of truth"):

1. `.btn-text` stays the single source of truth: `--text-headline` 600, `--color-accent`, 44px min-height, hover underline (pointer only), pressed opacity 0.7, disabled opacity 0.4 — states unchanged from v1 §8.1.
2. The color overrides at `:336–339` are **deleted** (the base token now passes everywhere — no variant is needed).
3. The size re-asserts at `:510` and `:693` are **deleted** (the base already says 44px).
4. The density rule at `:1339` becomes **one size modifier**: `.btn-text--compact { min-height: 32px }`, applied only inside the fine-pointer desktop density block (§6) and added as a class in markup — never as a descendant selector. Every place that today writes `.something .btn-text` shrinks to adding `btn-text--compact` where the 32px pointer density applies.
5. `.notice__summary` joins the component: the summary element carries `btn-text btn-text--compact` in markup (R3 may touch markup: "index.html, classes only"), its duplicate rules at `:649–658` collapse to layout-only leftovers, and the `:1339` site disappears with it.
6. Where text buttons render in v2 (all `--color-accent`): header "Start over"; toolbar "Add more" and "Tune thresholds" (§8); band-header "Select all" / "Deselect"; notice "Dismiss" and the notice summary; threshold-panel "Reset" (§8).

Contrast lock rows 12–14 certify the rule on all three surfaces; nothing about the rule depends on where the button sits, so R4's new text buttons ("Reset") inherit it by class, not by new CSS.

## 6. Rule change B — touch targets ≥ 44×44 CSS px on coarse pointers

**Criterion (plan-verified sources):** coarse-pointer controls must reach **44×44 CSS px** — Apple HIG Buttons, "a button needs a hit region of at least 44x44 pt" (fetched 2026-11-05; HIG page change log 2025-12-16). The absolute floor is WCAG 2.5.8's 24×24 CSS px (Level AA, verified, W3C doc updated 2026-05-11). The v1 sites at 32/36px violate neither WCAG (spacing holds) nor the old spec — they miss the Apple bar.

**The v1 gap, grounded.** v1 §7.3 said "All touch targets ≥44×44px *on mobile*; ≥32px with generous spacing on pointer devices." In the implementation, "mobile" is the <768px base and the density sizes live in `@media (min-width: 768px)` (`css/style.css:1313`) **with no pointer guard** — so an 820px tablet (coarse pointer, wide viewport) gets the desktop 32/36px density. The rule below re-draws the line by *pointer*, not by viewport.

**The v2 rule (replaces v1 §7.3's pointer-vs-touch bullet and v1 §12's touch-target bullet):**

> Every interactive control measures ≥ 44×44 CSS px whenever the pointer is coarse, at every breakpoint. The 32/36px pointer-device density applies only when the pointer is fine. Nothing interactive is ever below 24×24 CSS px (WCAG 2.5.8 floor).

**The four sub-44px sites and exactly what they become:**

| Site (inside `@media (min-width: 768px)`, `style.css`) | v1 value | v2 fine pointer | v2 coarse pointer |
|---|---|---|---|
| `:1334–1337` `.btn-primary, .btn-secondary { min-height: 36px }` | 36px | 36px (unchanged) | **44px** — the base value; no override applies |
| `:1339–1342` `.gallery-toolbar .btn-text, .notice__summary { min-height: 32px }` | 32px | 32px via the `.btn-text--compact` modifier (§5) | **44px** — the `.btn-text` base; the modifier is not applied on coarse pointers |
| `:1346–1349` `.band__toggle, .tile__meta-btn { min-height: 32px }` | 32px | 32px (unchanged) | **44px** |
| `:1408–1409` `.detail__nav { width: 36px; height: 36px }` | 36×36px | 36×36px (unchanged) | **44×44px** |

**Implementation shape for R3 (plain CSS, one mechanism):** gate the density block by pointer — `@media (min-width: 768px) and (pointer: fine)` — and keep a coarse-pointer block that restores/holds the 44px base values (equivalently: add the coarse values inside `@media (min-width: 768px) and (pointer: coarse)`). Spec-side the rule is the table above; R3 chooses the cleaner of the two equivalent encodings, provided the computed result matches the table on both pointer types at every width.

Consequences R3/R4 must honor:

- The base (all-widths) rules already carry 44px everywhere (`.btn-primary`/`.btn-secondary` at `:242`, `.btn-text` at `:302`, `.notice__summary` at `:652`, `.band__toggle` at `:820`, `.tile__meta-btn` at `:923`) — unchanged; only the ≥768px density block is pointer-gated.
- The detail-view chevrons are a ≥768px-only affordance (v1 §7.3) — on a 768px+ coarse-pointer tablet they must be 44×44, not 36×36.
- The hero CTA keeps its 48px height (`:294`) at every breakpoint.
- New R4 controls inherit the rule: the threshold sliders need a ≥44px-tall hit row (thumb ≥28px visual, padded track), the value inputs ≥44px tall on coarse pointers, "Reset" is a `.btn-text` (44px coarse / compact fine), and the ZIP primary is a `.btn-primary` (44px coarse / 36px fine).
- R3's e2e asserts computed target boxes ≥44×44 on a coarse-pointer context at 375px **and** at ≥768px (the tablet case is the regression this rule exists for).

## 7. §9a one-line sync — the drop hint is pointer-devices-only

**The implemented line (verified this session).** `js/UploadView.js:523` renders exactly `hint.textContent = "or drop photos here"` into `.empty-state__drop-hint` (`:521–524`), and `css/style.css:461–468` hides it on touch:

```css
/* Drag-and-drop cannot happen without a hover-capable pointer (§7.3 …) */
@media (hover: none), (pointer: coarse) {
  .empty-state__drop-hint { display: none; }
}
```

The phase-6 suite already locks this behavior (M2: hint hidden under touch emulation, visible on desktop).

**The drift.** v1 §9a's wireframe annotates the caption unconditionally — `or drop photos here · --text-subhead, --color-text-muted` — with no pointer condition. The spec lagged the implemented behavior (Phase 6 UX finding; plan Finding 3).

**The sync — v1 §9a is amended by exactly this line** (and the wireframe annotation in v1 §9a is replaced by):

```
│      │  or drop photos here │        │  pointer devices only — hidden on
│      │                      │        │  touch: drag-and-drop cannot occur
│      │                      │        │  (§7.3); --text-subhead, muted
```

One-line statement of the corrected behavior: **"or drop photos here" is a pointer-devices-only affordance — hidden on touch, because drag-and-drop cannot occur there (§7.3); styling is unchanged (`--text-subhead`, `--color-text-muted`, now `#646E7B` on `#F2F3F5`, pair 10 of §4.9).**

Notes for R3: the token values in the annotation update with §4 (text is now `#646E7B` on `#F2F3F5`, 4.66:1); the hiding behavior itself needs **no** code change — it already matches this section. On touch the caption is absent from the DOM flow, so the empty state composes identically to its folder-pick-absent variant (v1 §9a: "nothing shifts, nothing is disabled-looking").

## 8. Feature wireframe A — threshold tuning (R4) — **DEFERRED TO V3**

> **DEFERRED TO V3** — plan amendment (2026-11-05): threshold tuning was not among the instructor's asks and deferring it keeps v2 shippable (plan Decision Record amendment; backlog item 7). The "(R4)" above is the plan's *original* R4 (ZIP + thresholds), which moved to v3 — v2's R4 is the percentage phase. This wireframe is a v3 input, valid as written; **no v2 phase implements it** — the band cuts stay fixed at their named constants (`SCORE_BLURRY_MAX` / `SCORE_SHARP_MIN` in `js/Thresholds.js`) in v2.

Same wireframe language as v1 §9: ASCII at the 375px mobile base, every element referencing §4's tokens; desktop notes follow. The two thresholds are the named constants `SCORE_BLURRY_MAX = 40` and `SCORE_SHARP_MIN = 60` (`js/Thresholds.js:86–88`); banding is score < blurry-cut → Blurry, ≥ sharp-cut → Sharp, else Needs review. **The tuning control changes band membership only — scores, files, and the v1 default (40/60) never change.**

### 8.1 Anatomy and placement

Entry: a **"Tune thresholds" text button** in the gallery toolbar (`--color-accent`, §5 rule), right-aligned beside "Add more". Expanded, it opens an inline panel between the toolbar and the first band header — document flow, no overlay, no positioning logic (the panel is a card: `--color-surface`, hairline, `--radius-lg`, 16px padding; entrance is the v1 notice fade, `--duration-standard`). ≥768px: panel max-width 560px, left-aligned to the content column (anchored to the control that opened it); mobile: full content width.

Collapsed (default state):

```
┌──────────────────────────────────────┐
│ ▪ header: "Results"    [Start over]  │
├──────────────────────────────────────┤
│ Photos  24 photos                    │  toolbar (§8.1): label + count
│         [Tune thresholds] [Add more] │  + two text buttons; flex-wrap
│                                      │  at 375px puts buttons on row 2
│ (● Blurry) 12 photos    [Select all] │  ← §9c continues unchanged
```

Expanded (values at the 40/60 defaults):

```
┌──────────────────────────────────────┐
│ ▪ header: "Results"    [Start over]  │
├──────────────────────────────────────┤
│ Photos  24 photos                    │
│         [Tune thresholds] [Add more] │  toggle: aria-expanded="true"
│ ┌──────────────────────────────────┐ │
│ │ Band thresholds          [Reset] │ │  --text-headline; Reset = .btn-text,
│ │                                  │ │  disabled (0.4) while values = 40/60
│ │ Blurry · Needs review            │ │  row label --text-subhead, secondary
│ │ [━━━━━━●────────────]   [ 40 ]   │ │  slider (native range 1–59) +
│ │                                  │ │  value input: 44px tall, 4ch,
│ │ Needs review · Sharp             │ │  surface-muted fill, strong sep.,
│ │ [━━━━━━━━━━━━━●──────]  [ 60 ]   │ │  tabular-nums; slider: accent fill,
│ │                                  │ │  accent 20px thumb, 44px hit row
│ │ Blurry < 40 ≤ Needs review <     │ │  legend --text-footnote, tabular:
│ │ 60 ≤ Sharp                       │ │  band words in --color-band-*-text
│ └──────────────────────────────────┘ │  (6.52/6.21/6.27 on white), numbers
│ (● Blurry) 12 photos    [Select all] │  secondary; updates live
│ ┌─────┐ ┌─────┐ ┌─────┐              │
```

### 8.2 Control spec

- **Sliders** — native `<input type="range">` (keyboard: arrows/Home/End/PageUp-Down; no custom widgets). Visual: 4px track, filled left portion `--color-accent` (5.39:1 vs unfilled, §4.9 pair 40), unfilled `--color-fill-pressed`; thumb 20px `--color-accent` circle. The interactive *row* is ≥44px tall (coarse-pointer rule, §6). "Blurry · Needs review" slider range 1 … (sharp-cut − 1); "Needs review · Sharp" range (blurry-cut + 1) … 99 — ranges re-clamp live when the other value moves, so the cuts can never cross or touch.
- **Value inputs** — numeric (`inputmode="numeric"`), 44px tall on coarse pointers, `--color-surface-muted` fill, `--color-separator-strong` border, `--color-text` tabular-nums, `aria-label` "Blurry maximum score" / "Sharp minimum score". Out-of-range or crossing entries **clamp** to the nearest valid value (never an error dialog): a helper line appears under the row — "Kept below the Sharp cut (60)" or "Kept above the Blurry cut (40)" — `--text-footnote`, `--color-text-secondary`, and clears on the next valid edit.
- **Reset** — `.btn-text` in the panel header (§5 rule). Disabled while both values equal the 40/60 defaults; on press restores 40/60, re-bands, announces (below), and disables itself again.
- **Legend** — one muted line under the sliders: band words in their `--color-band-*-text` values (verdict color on verdict words — semantic, not decorative; 6.52/6.21/6.27 on white), numbers and separators in `--color-text-secondary`, all tabular-nums. It re-renders on every tick.

### 8.3 Behavior: live re-banding

- **During adjustment** (`input` event — dragging or typing): band sections and counts re-band **immediately** — tiles move between sections, counts update, empty bands render their §8.1 empty header ("0", "No photos in this band"). Scores and score chips never change. No animation on the move (tiles re-render in place; the band reveal is an analyzing→results moment, not a tuning one).
- **On commit** (`change` event — release or blur): the polite live region announces the new counts once — "12 blurry, 5 need review, 7 sharp" — never per tick.
- **Reset** announces "Thresholds reset to defaults: blurry below 40, sharp at 60 or above", and the bands return to **exactly** the v1 defaults (R4 e2e acceptance).
- **Thresholds are per-session only**: every visit starts at 40/60. Persistence is plan backlog item 2 and is explicitly **not** in R4 — no localStorage in this feature.

### 8.4 States

| State | What renders |
|---|---|
| Collapsed (default) | Toolbar text button only; bands at current thresholds |
| Expanded | Panel open; values 40/60; Reset disabled; legend current; toggle `aria-expanded="true"`, panel labelled by it |
| Adjusting | Bands and legend re-band live during drag/typing; no announcements; Reset enables the moment values ≠ 40/60 |
| Clamped | Invalid entry corrected; helper line under the row; slider and input agree |
| Applied (commit) | Live region announces counts once; panel stays open (tuning is exploratory — closing is the user's move) |
| Reset | Values 40/60; bands = v1 defaults; Reset disabled; announcement (§8.3) |

### 8.5 Accessibility

Keyboard-reachable end to end (plan R4 e2e): the toggle is a real button in DOM order; the panel follows it; sliders and inputs are native/focusable; Reset is focusable. Announced via the existing polite live region (v1 §12) on commit and reset only. Touch targets: slider rows, inputs, Reset ≥44px on coarse pointers (§6). Inclusive color: the legend carries the cuts in text and numbers — color only decorates words that are already legible alone.

Desktop (§7.3): panel 560px left-aligned under the toolbar; slider rows stay full panel width; everything else identical to mobile.

## 9. Feature wireframe B — ZIP export (R4) — **DEFERRED TO V3**

> **DEFERRED TO V3** — plan amendment (2026-11-05): ZIP export was not among the instructor's asks and deferring it keeps v2 shippable (plan Decision Record amendment; backlog item 6). The "(R4)" above is the plan's *original* R4 (ZIP + thresholds), which moved to v3. This wireframe is a v3 input and the verified JSZip 3.10.2 pin moves with it; **no v2 phase implements it** — no `assets/vendor/` is created in v2.

Same wireframe language as v1 §9. The action bar's primary action becomes **"Download selected (.zip)"** (the plan R4 acceptance string; supersedes v1's "Download selected" label — same control, same position, new packaging behavior). **[DEFERRED TO V3 — in v2 the action bar's primary stays "Download selected" (§11.7e); the "(.zip)" label and the packaging behavior described here are v3 work.]** It packages the **selected** photos' original bytes — byte-identical, stored without recompression (photos are already compressed; the archive must not alter files) — into a single archive named **`photos.zip`**, downloaded as one blob. The v1 sequential-download behavior is fully replaced for the batch action; the detail view's per-item "Download this photo" is unchanged and never zips.

### 9.1 Anatomy

The action bar (v1 §8.1/§9c) keeps its structure — left summary slot, right "Add more" secondary + ZIP primary — and gains one permanent caption line beneath it:

```
├──────────────────────────────────────┤
│ 3 selected · 24 total                │  summary slot --text-footnote,
│ [Add more] [Download selected (.zip)]│  tabular; primary: accent fill,
│ Review here, delete these files on   │  --radius-md, 44px coarse / 36px fine
│ your phone                           │  first-visit device line (§13)
│ Zipped on this device with the       │  vendored-library disclosure:
│ bundled JSZip 3.10.2 (MIT license)   │  --text-caption-2, muted (4.66 on bg)
└──────────────────────────────────────┘
```

- **Vendored-library disclosure** — one calm line, always visible on results screens, stacked under the first-visit device-reality line: *"Zipped on this device with the bundled JSZip 3.10.2 (MIT license)."* It names the library, version, license, and locality — the user-facing half of the disclosure; the repo-level half is `VENDORS.md` (version + license record, R4 per plan). The library runs locally; the zero-network promise (R2's CSP `connect-src 'none'` + netcheck) still proves it.
- The line is `--text-caption-2` (11px, v1's smallest meta role) in `--color-text-muted` on `--color-bg` — 4.66:1 (§4.9 pair 10). Sentence case; it is a body sentence, so it keeps its period (v1 §13); no praise.

### 9.2 States

| State | Summary slot | Primary button | Other |
|---|---|---|---|
| Default | "3 selected · 24 total" (tabular) | "Download selected (.zip)" | — |
| Disabled | unchanged | disabled style (v1 §8.1): surface-muted fill, muted label — shown at 0 selected; selecting remains possible | — |
| Zipping (progress) | "Zipping 12 of 24" (tabular, updates as files are added) | label "Preparing ZIP…" + the 16px inline spinner (the one permitted loop, §6.2); not re-clickable | "Add more" disabled; selection locked |
| Done | "photos.zip saved · 24 photos" — **persists until the next selection change** (state, not a timer) | returns to default label | live region announces "photos.zip saved — 24 photos" once |
| Failed | unchanged | returns to default | notice card per §8.2 (below) |

- **Failure state** — if archive creation or the download fails, a notice card renders in content flow (never a modal/toast, v1 §8.2): heading "Couldn't create the ZIP" (`--text-title-3`), body naming the failed step and that nothing was changed (`--text-subhead`, secondary), actions "Try again" (primary) + "Dismiss" (text button). Reuses the generic-error variant's behavior exactly.
- **Done is quiet by design** — a text swap in the summary slot plus the announcement; no animation, no auto-dismiss countdown. The next selection change or "Add more" restores the counting summary.

### 9.3 Behavior contract for R4

- ZIP contents = **exactly the current selection** at press time (plan e2e: contents match the selection; valid archive). Zero-selected is blocked by the disabled state (and guarded in code).
- Fixed name `photos.zip`; the browser deduplicates repeat downloads.
- The vendored library is pinned JSZip **3.10.2** at `assets/vendor/jszip.min.js`, license recorded in `VENDORS.md`; it is vendored — no CDN, no network (§10 zero-dependency note). The netcheck suite still passes with it present.
- Originals stay byte-identical inside the archive (stored, not recompressed) — the same honesty as v1's byte-identical downloads.
- Works at 375px and desktop with the §6 target sizes; the bar's content caps to the content width on desktop (floating dock, v1 §7.3).

Desktop (§7.3): identical states; the action bar reads as a floating dock, content capped to 1200px; the two caption lines sit under the dock, left-aligned to the summary slot.

## 10. Carry-forward — what v1 still governs, prohibitions, zero-dependency

### 10.1 What v1 continues to govern (unchanged by this revision)

v1 §2 product direction and restraint rules · §4 typography (system font stack, type scale, type rules) · §5.1 spacing (4px grid) · §7 layout and responsive system (shell, breakpoints, grid, desktop adaptations — with §6 of this file replacing its pointer-vs-touch bullet) · §8 components (as amended by §5's text-button rule and the §8/§9 feature components) · §9 screen wireframes (with §7's §9a amendment and the two new R4 features) · §10 state machine · §11 progressive enhancement (folder pick) · §12 accessibility (with §6's touch-target replacement) · §13 copy rules.

The v1 appearance-scope note carries: light appearance is the design of record; tokens are named semantically so the plan's deferred dark variant (backlog 1) is a token swap on the grey scale — nothing in v2 hard-codes lightness assumptions outside §4.

### 10.2 Prohibitions — v1 §14.2 carried into the grey system, verbatim in intent

Never in any screen, state, or breakpoint: glows, colored shadows, gradient fills or gradient text, blur blobs, neon borders, glass beyond the header's standard material · looping/decorative motion beyond the single spinner; bounce/elastic easing · the colored left-border panel (notices are hairline cards); purple-to-blue gradients; emoji as icons or labels; uppercase tracked labels; italic emphasis · one radius everywhere (nested per §4.6); cards nested in cards; glowing pills for counts/badges · more than one accent; accent as body-text color (text buttons/labels are controls, not body copy — and §5's one-token rule keeps them consistent) · disabled-look controls for unsupported features (absent instead); modal alerts for recoverable conditions · delete affordances of any kind · anything below 11px; any text outside the v1 §4.2 scale; any spacing/radius/duration outside the tokens.

**The grey-specific watch list** (the unslop signals this restyle must not trip): no low-contrast grey body text — §4.9 certifies every grey at ≥4.5:1 on its real composites; no washed-out grey-on-grey hierarchy — the single accent, the four distinct surface steps, and the ink ramp carry structure; no radius inflation — three nested sizes, one soft step up. R3 runs the `unslop` audit against exactly these.

### 10.3 Zero-dependency statement, amended for R4 (plan-approved exception)

v1 §14.1's statement carries — no framework, no build tool, no external font or icon, no CDN — with **one explicit, plan-approved addition for R4**: JSZip **3.10.2** (MIT OR GPL-3.0-or-later, npm-verified in the plan) is vendored locally at `assets/vendor/jszip.min.js`, its version and license recorded in `VENDORS.md`. It is a local file, not a network dependency: it loads from the same origin, runs entirely on-device, and R2's CSP (`connect-src 'none'`) plus the netcheck prove it requests nothing. The vendored-library disclosure line (§9.1) is its user-facing record. No other dependency is permitted by this spec.

### 10.4 Implementation notes for R3/R4 (plain-CSS implementability)

- Every value in §4 is a CSS custom property or a plain property value — nothing here needs a preprocessor, an image asset, or a new font. The one-line header material stays `background` + `backdrop-filter` as in v1.
- **Slider filled-track note (R4):** v1 §5.3's "a gradient is allowed nowhere in this app" prohibits *decorative color ramps* (§3, §10.2). A slider's filled-track fill is a control state, not decoration — the sanctioned reading of the prohibition. Implement it as a hard-stop two-color `background` on the track (one accent stop, one fill-pressed stop, updated from JS on `input`) or as a layered fill element under a transparent-track input — implementer's choice, visually identical; no decorative gradient is permitted anywhere.
- R3 must produce **zero behavior change** beyond §5 and §6: the blur-fixture scores and bands stay byte-identical (plan R3), all v1 e2e suites stay green, and the v1 visual states re-verify at 375px + desktop.
- R4 builds §8/§9 on the final R3 tokens; no hex in views outside §4's tokens (plan acceptance); the `--color-track` token (§4.7) replaces the progress bar's inline value.
- The report page (`docs/report.html`) keeps its print styling — the grey direction applies to the app only (plan assumption).

---

# R1b addendum — instructor features (percentage display, HD converter, session delete)

**Everything from here to the end of the file is the Phase R1b addendum** (plan `plans/blurry-photo-cleaner-v2-restyle.md`, Phase R1b). §1–§10 above are untouched and remain the Reviewer-PASSed design of record; where a feature below changes a rule stated earlier, §11.1 lists the amendment explicitly.

### 11.0 Coverage map and references consulted for this addendum

| | |
|---|---|
| Artifact | this file, §11 — R1b addendum to the design of record |
| Status | draft for artifact review (Phase R1b check: cheap, artifact review only) |
| Created | 2026-11-05 |
| Owner | designer |
| Governs | R4 (percentage), R5 (HD converter), R6 (delete + recommendations) of `plans/blurry-photo-cleaner-v2-restyle.md` |
| Scope | Design only. Names new modules (`js/HDConverter.js`, `js/upscale-worker.js`) and constants (`js/Thresholds.js`) that the plan's R5/R6 create — no code is written here. |

**Requirement coverage map** (delegation items → sections):

| Requirement | Where |
|---|---|
| 1. HD converter: slider + readout, capability clamp, honest copy, naming/format/quality, per-photo + batch flows, states | §11.3 |
| 1a. Mandated old→new resolution slide animation (+ reduced-motion fallback) | §11.4 (tokens in §11.6) |
| 2. Session delete: confirmation dialog, focus management, recommendations, honesty copy, live-region announcement | §11.5 |
| 3. Percentage display: "NN% sharp" format, mapping, every surface, subtitle, badge | §11.2 |
| 4. Motion + a11y for all three (focus, keyboard, live regions, reduced motion, 44px targets) | §11.6 |
| Wireframes at 375px and desktop for all new surfaces | §11.7 |
| Acceptance self-check + recorded interpretation decisions | §11.8 |

**References fetched for this addendum (2026-11-05):**

- **W3C ARIA Authoring Practices Guide — Dialog (Modal) pattern** — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ (fetched 2026-11-05). Source of the delete-dialog contract in §11.5: `role="dialog"` + `aria-modal="true"` only when interaction outside is truly blocked *and* visually obscured; label via `aria-labelledby` to a visible title; Tab/Shift+Tab cycle contained; Escape closes; on open, focus moves inside — and **for a process that is not easily reversible, initial focus belongs on the least destructive action**; on close, focus returns to the invoking element, or to a logical element when that element no longer exists.
- **Apple Human Interface Guidelines — Buttons** — https://developer.apple.com/design/human-interface-guidelines/buttons (fetched 2026-11-05; page change log 2025-12-16). Source of: the destructive **role** ("performs an action that can result in data destruction") rendered in the system red; the rule that a destructive action must **not** take the primary role even when it is the most likely choice; and the re-confirmation of the 44×44 pt hit region the plan already pinned.
- **Plan-pinned sources reused without refetch**: Apple HIG Color (band values, inclusive-color rule — §4.3 above) for the recommendation framing; WCAG 2.5.8 (24×24 CSS px floor) under §6's target rule; WCAG 1.4.3/1.4.11 thresholds under §4.9.

**Implementation surface verified this session** (so every path/symbol below is grounded, per the incremental-writing rule):

- `index.html:36` — the shipped CSP `worker-src 'self'` (same-origin file workers only; `js/upscale-worker.js` fits it, blob workers would not) and `connect-src 'none'` (the converter is pure local canvas — the zero-network promise holds).
- `index.html:98` — the single polite live region (`#live-region`, `role="status"`, `aria-live="polite"`) that every announcement below reuses.
- `js/ResultsView.js:440–737` — the existing detail-view dialog machinery this addendum's dialog reuses as a pattern: `role="dialog"` + `aria-modal` on the panel, container `aria-label` (":618–620"), panel-scoped Tab trap (":704–737"), focus-parking on disable (":667–686"), focus return to the invoking tile button.
- `js/Thresholds.js:94–95` — `SCORE_BLURRY_MAX = 40`, `SCORE_SHARP_MIN = 60` (the recommendation set's definition; threshold tuning itself is deferred to v3, so these are constants in v2). R5 adds `MAX_UPSCALE_FACTOR = 4`, `JPEG_QUALITY = 0.92`, and the output-naming constant here per the plan.
- `js/ReviewControls.js` — the action bar module (summary slot, "Add more" secondary, "Download selected" primary, `:192` device-reality line, `:35–45` the one anchor-download mechanism with bounded URL revocation, `:17` sequential-download spacing).
- `js/PhotoStore.js` — photo records (`thumbURL`, `file`, `score`, `band`), `applyAnalysis`, and URL revocation on clear — the pattern deletion extends.
- `js/App.js:140,159` — the "Start over" native-confirm precedent and the "Gallery cleared." announcement shape.
- `js/UploadView.js:641–653` — the pending-grid score chips that must adopt the percentage format alongside ResultsView's.

### 11.1 What this addendum amends — and what it leaves untouched

The three features are plan-mandated (Decision Record amendment, 2026-11-05) and several of them necessarily supersede lines the earlier specs wrote for a delete-less, motion-frozen app. Each amendment is listed here so R3–R6 implement against one coherent rule set, and so nothing silently contradicts §1–§10.

**Amendments (each grounded in the line it replaces):**

1. **v1 §14.2 / v2 §10.2 — "delete affordances of any kind"** → narrowed to: *device-file* deletion affordances remain prohibited forever (nothing here deletes, trashes, or frees files on the phone); **session-gallery** delete affordances now exist — per-tile, in the detail view, and batch-on-selection — and every one of them opens the §11.5 confirmation dialog before anything is removed. There is no path to removal that bypasses the dialog.
2. **v1 §2 restraint rule — "no deletion affordances (the app cannot delete; delete happens on the phone)"** → amended by the same narrowing; the honest device-reality copy (v1 §13: *"Review here, delete these files on your phone."*, verified live at `js/ReviewControls.js:192`) is **retained unchanged** and gains a second duty: it is also the caption inside the delete dialog (§11.5).
3. **v1 §8.2 icon inventory — "No trash icon exists anywhere in the app"** → **unchanged, deliberately.** Delete controls are text labels ("Delete"), never a trash glyph — the icon set stays exactly as inventoried, and the quiet text label keeps deletion from reading as a primary capability.
4. **v1 §6.2 allowed-motion list / v2 §4.6 "No new motion is introduced by v2"** → exactly **one** sanctioned addition: the *resolution number-slide* (§11.4) on the HD converter's target readout — transform-only, non-looping, communicates "the target changed". Every other new surface reuses motion already on the v1 §6.2 list (modal entrance, spinner, progress bar, button press). The forbidden list (§6.3) and the reduced-motion collapse (§12) gain no exceptions beyond §11.4's static swap.
5. **v1 §3.5 color-job rules — red's job list** → red (the `--color-band-blurry` family) currently means "blurry verdict + blocked error". It gains exactly one role: **the destructive affordance**, rendered on exactly **two sanctioned surfaces** — the **destructive confirm control inside the delete dialog** (`--color-band-blurry-text` on the white card, §11.5.3) and the **detail-view Delete** (`--color-band-blurry-stage` on the dark stage, certified 5.23:1, §4.9 pair 30; §11.5.2). No third red surface exists — the tile Delete and the batch "Delete selected" stay neutral (§11.5.2). The accent's job list (v2 §4.2: selection, primary action, focus, drag-over, progress) is unchanged — notably, the destructive confirm is *not* accent-styled (HIG Buttons, fetched 2026-11-05: never give a destructive action the primary role), so the one-accent rule holds.
6. **v1 §13 copy rules — new standing rule for upscaling:** *no converter copy may say "enhance", "improve quality", "magic", "AI", or otherwise claim added detail* — browser upscaling is canvas resampling (`drawImage`, `imageSmoothingQuality: high`): it enlarges pixels and adds **no real detail** (plan Decision Record). The sanctioned framing is §11.3's caption pair. The honesty bar for the percentage ("the score measures sharpness") is already plan law (R4 acceptance: no "good resolution" copy) and is restated in §11.2.
7. **v1 §8.1 photo tile / §9d detail bottom bar / §9c band header anatomy** → each gains the specific elements §11.2/§11.3/§11.5 place on it (chip format, delete control, recommendation action); the underlying components (buttons, chips, band sections) keep their v2 anatomy, states, and tokens.
8. **v1 §9c — "Start over" native `confirm()`** → **not** touched by R1b (out of the three features' scope). It is recorded in §11.8 as a consistency note only.

**Carried forward unchanged (restated so no implementer has to guess):**

- The privacy promise and zero-network proof: the converter is pure local canvas + same-origin worker (fits the shipped `worker-src 'self'`, `index.html:36`); the netcheck suite stays green.
- The one-polite-live-region discipline (`index.html:98`); new announcements reuse it — no second region, no toasts.
- All v2 tokens (§4): **this addendum defines zero new colors.** The destructive control and every new surface compose exclusively from existing R1 token values (mapping in §11.6.7).
- Touch targets (§6): every new control obeys 44×44 CSS px on coarse pointers at every breakpoint.
- The session-scoped mental model: deletion and "Start over" are the same kind of event — session-state changes whose honest harm is low because files re-add by re-picking (plan: no undo in v2).

### 11.2 Percentage display — "NN% sharp"

**Format (plan-verbatim):** every score displays as **`NN% sharp`** — the integer score, a percent sign, one space, the word "sharp" (e.g. `80% sharp`). The instructor's "80% good resolution" phrasing is deliberately not adopted (plan Decision Record): the number measures *detected sharpness*, and the copy must say so.

**Mapping (identity):** the percentage **is** the stored 0–100 score — no transformation, no re-rounding. `normalizeScore` already returns a rounded integer 0–100 (`js/Thresholds.js:154–160`), so the display is `String(score) + "% sharp"`. Score 0 renders as `0% sharp` (a real measurement); there is no clamp, no floor, no average anywhere.

**Everywhere it appears (and nowhere else):**

| Surface | Renders | Notes |
|---|---|---|
| Tile score chip (results grid) | `● 80% sharp` | Same chip component (v1 §8.1): 8px band-color dot + text in `--color-band-*-text` on the page background (§4.9 pairs 19/23/27: 5.87/5.59/5.65). `--text-footnote`, `tabular-nums` — tabular so grids of chips align and widths stay stable |
| Tile score chip (pending grid, `js/UploadView.js:641–653`) | `● 80% sharp` as each score lands | Identical format the moment a score arrives during analysis; **layout stability rule carries** (v1 §9b: the chip row's height never changes when the score lands) |
| Detail-view stage chip | `● 80% sharp · Blurry` | Existing anatomy (`chip__num` + `chip__word`, `js/ResultsView.js:622–632`): number takes the percentage format, band word keeps the `·` prefix; stage band tokens (§4.9 pairs 30–32) |
| Delete-recommendation badge | **text-only — "Suggested"** (no percentage inside) | The badge is text-only ("Suggested", §11.5.5) and **never contains a percentage**; the *percentage informs* the recommendation via the tile's own `NN% sharp` chip co-located on the same tile — the badge renders exactly when that chip's value is below the blurry cut (§11.5.5) |
| Band section headers | **no percentage — by decision (Ruling D1)** | A band holds many stored scores; one number would misrepresent them, and the only honest band-level figures (the fixed band cuts, `SCORE_BLURRY_MAX` / `SCORE_SHARP_MIN` in `js/Thresholds.js`) belong to the deferred v3 tuning feature. Band headers keep chip + count (+ the §11.5 recommendation action on the Blurry band); a threshold descriptor is permitted under the derivation rule below. Any future band-context number inherits this format (§11.8, interpretation note 1) |
| Skipped photos and the skipped band | `—` | **Unchanged from v1 and mandatory**: skipped photos never show `0% sharp` — no score exists. The pending state (`—`, `--color-fill-pressed` dot) is likewise unchanged |

**Threshold descriptor derivation rule (Ruling D1, re-review #2):** if a band header carries a threshold descriptor (e.g., "Blurry · below 40% sharp"), the number inside it is **derived from** the band threshold constants `SCORE_BLURRY_MAX` / `SCORE_SHARP_MIN` in `js/Thresholds.js` and rendered from those constants at runtime — the same never-drift rule as the v2 intake-cap labels (the `MAX_FILE_LABEL` precedent). No descriptor may carry a literal — in markup, copy, or spec text — that can drift from the enforced constants; R4's e2e checks any descriptor text against the configured band constants (plan R4 acceptance, Ruling D1).

**The one-time explanatory subtitle** (plan-mandated bridge between the instructor's intent and the truth):

- Copy: **"Percentages are based on detected sharpness."** — one sentence, period, no praise (§13 voice).
- Placement: a single line in the results flow, directly above the first band header (below any §9e notice card) — one instance for the whole screen, never per tile or per band.
- Styling: `--text-subhead`, `--color-text-secondary` on `--color-bg` (§4.9 pair 7: 5.74 ✓).
- Lifetime: it renders when results first display and stays while they do; it is not per-session-state — a fresh set of results after "Start over" shows it again. No dismiss control, no timer, no animation (a dismissible honest line spends complexity to hide the truth).
- Screen-reader behavior: plain text in flow; no live region (it does not change).

**Layout consequence (the one token-clean reflow this feature causes):** `80% sharp` is ≈3× the width of the bare score it replaces, and a tile's meta row cannot hold chip + file size at 375px (3-column tiles ≈ 111px wide). The **file-size caption yields its tile slot and moves to the detail view** (§11.5 adds it to the detail caption line, where the delete-on-phone workflow actually uses it). Tile meta becomes: filename line, then the percentage chip line — two lines at R4; §11.5.2 (R6) adds the third, the per-tile Delete row. Every tile carries the same row structure, so the grid never jumps.

**Copy rules for R4 (e2e-greppable):** no raw score number remains user-facing anywhere (the number exists only inside `NN% sharp`); the words "good resolution" appear nowhere; the subtitle appears exactly once per results view; every scored photo's displayed percentage equals its stored score exactly (presentation-only change — scores, bands, and the analysis pipeline are untouched).

### 11.3 HD converter — honest upscaling (per-photo detail view + batch)

**What it is.** A download factory: it resamples a photo to a larger pixel size (canvas resampling, `imageSmoothingQuality: high` — the plan's Decision Record), saves the result as a download, and touches nothing else. It **adds no detail** — copy and behavior both say so. Outputs are **downloads only**: they are never added to the session store, never scored, never re-banded, never counted in "N total" — a photo's score stays tied to its original bytes, always.

#### 11.3.1 Constants and files (plan-verbatim; R5 creates them)

| Item | Value / path | Notes |
|---|---|---|
| Slider range | 1× – 4×, step 0.5 | `MAX_UPSCALE_FACTOR = 4` in `js/Thresholds.js` — the *ceiling*; the effective max is the runtime probe (§11.3.3), never a hardcoded browser limit |
| JPEG quality | 0.92 | `JPEG_QUALITY = 0.92` in `js/Thresholds.js` |
| Output naming | `{basename}-hd.jpg`; PNG sources keep their extension → `{basename}-hd.png` | naming constant in `js/Thresholds.js`; `basename` = filename minus its final extension (`.jpeg` → `.jpg`) |
| Worker | `js/upscale-worker.js` (same-origin file) | fits the shipped CSP `worker-src 'self'` (`index.html:36`); OffscreenCanvas + `createImageBitmap` with a mandatory main-thread canvas fallback (plan; the fallback makes support non-blocking) |
| Module | `js/HDConverter.js` | probe + convert orchestration; UI-agnostic |

#### 11.3.2 Per-photo flow (detail view)

**Entry.** The detail view's bottom bar (v1 §9d) gains **"Save HD copy"** as a **secondary** button beside "Download this photo" (which stays the accent-filled primary — the converter entry never steals the accent). The button renders **only when the capability probe — run when this detail view opens (§11.3.3), before any converter exists — finds a factor above 1×**: an unsupported capability is *absent*, never disabled-looking (v1 §11). The entry decision consumes a finished probe result; the converter panel itself runs no probe.

**Panel.** Pressing it expands an inline converter panel inside the detail dialog, directly above the bottom bar — a white card (`--color-surface`, hairline, `--radius-lg`, 16px padding) on the dark stage; every text token inside is a certified white-surface pair (§4.9). Entrance: fade only, `--duration-standard` (the notice-card entrance — no rise, it is an expansion, not a new layer). While the panel is open, "Download this photo" **demotes to secondary** (fill swap only) so exactly one accent fill is on screen — the same primary→secondary swap mechanic as the Select/Selected toggle (v1 §9d).

Anatomy (top to bottom):

```
│ Save an HD copy                          [Cancel] │  --text-title-3 heading;
│                                                   │  Cancel = .btn-text (§5)
│ Original 3024 × 4032 · Output 6048 × 8064        │  readout row: "Original" static
│                                                   │  secondary; Output value is the
│                                                   │  ANIMATED element (§11.4);
│ Size              [──────●───────────]    2×     │  both --font-mono, tabular-nums
│                                                   │  native range 1–4× step 0.5;
│ This browser supports up to 4× for this photo.   │  20px accent thumb, accent fill,
│ Upscaled — enlarged, same captured detail.       │  44px hit row; clamp note +
│ Saved as IMG_4187-hd.jpg · JPEG, quality 92      │  honesty captions (§11.3.5)
│                                                   │
│ [        Convert and save        ]               │  accent-filled primary
│ Saved as a download. It never re-enters the      │  scope caption, --text-caption-1
│ review — scores and bands stay with your         │  muted
│ originals.                                        │
```

- **Slider** — native `<input type="range">` (v1 §8.2 control language): arrows step ±0.5, Home/End to the limits; `aria-label "Upscale factor"`, `aria-valuetext` "1.5×". Filled track = accent hard-stop two-color background (the sanctioned §10.4 reading); unfilled `--color-fill-pressed` (§4.9 pair 40).
- **Readout** — `Original {w} × {h}` is static secondary text (the decoded, EXIF-honored dimensions); `Output {w′} × {h′}` is the live target = `round(w × f) × round(h × f)`. **The readout and the saved file's dimensions must agree exactly** — one rounding rule, computed once, consumed by worker and UI alike. At 1× the Output equals the Original.
- **Apply ("Convert and save")** — accent-filled primary, **disabled at 1×** with the helper line "Pick a larger size to save a copy." (a no-op conversion would silently re-encode; the disabled state is the sanctioned zero-selected precedent, v1 §10). Enabled the moment the factor leaves 1×.
- **Focus** — opening the panel moves focus to the slider; Cancel collapses the panel and returns focus to "Save HD copy". The panel lives inside the detail dialog, so the existing focus trap (`js/ResultsView.js:704–737`) contains it with no new machinery.

**Flow: apply → processing → done.** Press disables the panel's controls, swaps the apply label to "Upscaling…" + the 16px inline spinner (the one permitted loop), and announces nothing yet (sub-second work). Done: the download fires through the one anchor mechanism (`triggerAnchorDownload`, `js/ReviewControls.js:35`), the panel returns to idle with a done line — **"Saved IMG_4187-hd.jpg."** — and the live region announces **"IMG_4187-hd.jpg saved — 6048 × 8064."** once. The stage photo, chip, scores, bands, counts: unchanged.

#### 11.3.3 Capability probe and clamp behavior (never hardcoded)

- **Probe**: when the **detail view opens** for a photo — not "when the converter opens": the result must already exist to gate the entry button — the app runs the plan's **allocate-and-test** probe: for each candidate factor from 4× down to 1.5× (0.5 steps), it attempts to allocate and draw a canvas at the resulting target size, inside try/catch. The largest factor that succeeds becomes the photo's **supported max**; the result is cached per photo. Because the probe runs at detail-open, the "Save HD copy" entry's presence (§11.3.2) and the Unavailable state (§11.3.6) are decidable before the converter panel can ever open. No browser, version, or platform string is ever consulted — iOS canvas-area limits (the motivation, marked unverified in the plan) are made irrelevant by measuring the actual device.
- **Clamped slider**: the slider's `max` is set to the supported max. When it clamps below 4×, a visible note renders under the slider — **"This browser supports up to {max}× for this photo."** (`--text-footnote`, `--color-text-secondary`) — so the ceiling is always explained, never silently hit.
- **Fully clamped (max = 1×)**: no upscale is possible for this photo; the probe already ran when the detail view opened (§11.3.3), so the "Save HD copy" button is **absent** from the bottom bar from the start (v1 §11: absent instead of disabled) — the Unavailable state is decidable without opening any converter — and the rest of the app is untouched: the original download remains the largest safe copy.
- **Batch clamping** (§11.3.4): the probe runs per photo at convert time; a photo that cannot reach the chosen factor is saved at its own supported max, and the done summary discloses the count — never silently.

#### 11.3.4 Batch flow — "Save HD copies" (action bar)

**Entry.** The action bar's actions row (currently "Add more" secondary + "Download selected" primary, verified in `js/ReviewControls.js`) gains **"Save HD copies"** as a third **secondary** button, DOM order: Add more · Save HD copies · Download selected. Disabled at 0 selected (the sanctioned zero-selected precedent); the row flex-wraps at 375px (two buttons per row) — no new bar anatomy beyond the extra button.

**Dialog.** Pressing it opens the batch converter as a **modal dialog** reusing §11.5's dialog machinery (the pattern already proven in `js/ResultsView.js:440–737`): `role="dialog"` + `aria-modal`, labelled title, focus trap, Escape = cancel, focus returns to the button. Content: heading **"Save HD copies"**; the same slider control (1×–4×, step 0.5, same readout styling); the line **"Saves the {N} selected photos at {factor}× their original size."**; the honesty + scope captions (§11.3.5); the clamp disclosure **"Photos above this browser's canvas limit save at their largest supported size."**; and the accent-filled **"Convert and save"** primary. There is deliberately **no per-photo resolution readout here** — N photos have N original sizes, and one merged old→new pair would be false; the per-photo old→new readout (and its mandated animation) lives in §11.3.2 where both numbers are exact.

**Progress.** On apply, the dialog's body swaps to the analysis-batch progress pattern (v1 §8.2, plan-sanctioned reuse): a determinate bar (`transform: scaleX()`, track `--color-track`, accent fill) + **"Upscaling 3 of 12"** (`--text-footnote`, tabular) + the current filename in `--font-mono`, truncated. Each completed photo's download fires immediately (the one anchor mechanism, sequential spacing per `js/ReviewControls.js:17`); selection and the rest of the bar are locked for the duration ("Add more", "Download selected", "Delete selected" disabled; tiles inert to selection toggles until done).

**Done / failed.** Done: the dialog shows **"{N} HD copies saved."** (+ "Saved at a smaller size (browser limit): {k}." when clamps occurred) with a **"Done"** button; the live region announces **"{N} HD copies saved."** once. Failure partway (worker/canvas error): **"Saved {k} of {N} HD copies."** + "Try again" (re-queues only the unsaved) + "Cancel" — already-saved files stay saved and the summary says so. Total failure before the first file: the generic-error shape ("Couldn't upscale these photos. Nothing was changed." + Try again + Cancel). Never a modal-on-modal alert: the dialog itself *is* the surface.

#### 11.3.5 Honesty copy — exact strings (no "enhance"/"magic" anywhere)

| Surface | String |
|---|---|
| Panel / dialog heading | "Save an HD copy" / "Save HD copies" |
| The honest label (plan-mandated framing, both flows) | "Upscaled — enlarged, same captured detail." |
| Scope caption (both flows) | "Saved as a download. It never re-enters the review — scores and bands stay with your originals." |
| Per-photo format line | "Saved as {basename}-hd.jpg · JPEG, quality 92" — PNG sources: "Saved as {basename}-hd.png · PNG" |
| Clamp note (per-photo) | "This browser supports up to {max}× for this photo." |
| Batch clamp disclosure | "Photos above this browser's canvas limit save at their largest supported size." |
| 1× helper | "Pick a larger size to save a copy." |
| Done (per-photo / batch) | "Saved {name}." / "{N} HD copies saved." |
| Failure | "Couldn't upscale this photo. Nothing was changed." / "Couldn't upscale these photos. Nothing was changed." |

Sanctioned vocabulary: *upscale(d), larger size, HD copy, resolution, dimensions*. Prohibited: *enhance, improve, better quality, quality boost, magic, AI, fix* — the constraint is plan law (Decision Record) and R5's e2e asserts it.

#### 11.3.6 States (both flows)

| State | Per-photo (detail panel) | Batch (dialog) |
|---|---|---|
| Idle | Panel open at 1×: apply disabled + helper; readout = Original | Dialog open at 1×: same helper; N-photos line |
| Adjusting | Readout slides on each factor change (§11.4); apply enables above 1× | Same slider behavior; summary line updates |
| Clamped | Slider max = probe result; visible note | Per-photo clamp at convert time; disclosed in done state |
| Processing | Apply label "Upscaling…" + spinner; controls disabled | Progress bar + "3 of 12"; bar locked; downloads stream |
| Done | "Saved {name}." line; panel stays open at the chosen factor | "{N} HD copies saved." + Done button |
| Failed | Inline error + "Try again"; nothing changed | Partial/total variants (§11.3.4) |
| Unavailable | No "Save HD copy" button (probe max = 1×) — absent, not disabled | Entry disabled at 0 selected (state, not capability) |

#### 11.3.7 What conversion must never do

Never inject an output into the gallery, the score set, or any count ("N total" excludes HD copies by construction — they never become records); never re-score or re-band anything (a resampled file would score *differently*, and displaying that drop would mislead — plan Decision Record); never touch the CSP, add a dependency, or make a network request; never overwrite the original file's download; never use the words §11.3.5 prohibits.

### 11.4 The mandated resolution slide animation

The plan makes this animation a MUST (Decision Record amendment: "The slide animation old→new resolution is a MUST (user emphasized)"). It is the one new motion v2 sanctions (§11.1 amendment 4). Exact spec:

**Name:** *resolution number-slide* — added to the v1 §6.2 allowed-motion list as: "Resolution number-slide | HD converter Output readout (per-photo) | Target value slides one line into a clipped window, direction follows the value delta, `--duration-standard`, `--ease-standard`; transform-only; collapses to an instant swap under reduced motion."

**What slides:** **only the Output value** in the per-photo readout ("Output 6048 × 8064", §11.3.2) — the *old* target slides out of a one-line window while the *new* target slides in, so the readout visibly morphs **old resolution → new resolution**. Nothing else moves: "Original 3024 × 4032" is static; the slider, captions, and buttons change state without motion.

**Direction:** the value **increases** → the incoming number rises from below the window while the outgoing rises and out (the stack reads "growth"); the value **decreases** (slider dragged down) → the mirror motion, incoming drops in from above. The direction is part of the meaning — the motion tells the user the target got bigger or smaller, which is exactly the §4.6 motion test (carrying v1 §6.1: "tells the user X changed").

**Tokens (from §4.6 of this spec, which carries the v1 §6 motion system, at v2 values):**

| Property | Value |
|---|---|
| Duration | `--duration-standard` = **200ms** — this is state-change feedback (the §4.6 duration table's own assignment, v1 §6.1), not an entrance; the slower 320ms entrance token would lag behind a dragging thumb |
| Easing | `--ease-standard` = **`cubic-bezier(0.25, 1, 0.5, 1)`** (§4.6) — fast attack, gentle settle; the app's single curve, no exceptions |
| Animated property | **`transform: translateY()` only**, inside a fixed-line-height window with `overflow: hidden` — the width/height/top/left whitelist rule (v1 §6.1) holds; digit-count changes reflow width **instantly**, never transitioned |
| Stagger | none — a single element |

**Rapid changes:** dragging the slider fires changes faster than 200ms. A change that begins mid-slide does **not** queue: the mid-flight stack is replaced and the transition restarts from its current offset toward the newest target; the text content is always the current value. Worst case under fast dragging is a slightly truncated slide — never a stale number, never a burst of queued animations.

**Initial render:** when the panel opens, the readout appears with the current target **without animation** (motion fires on *change*, never on entrance — §4.6's no-entrance rule, v1 §6.3, applied to numbers).

**Reduced-motion fallback (§12):** under `prefers-reduced-motion: reduce` there is **no slide, no crossfade, no fade** — the Output value swaps **instantly** (crossfade-free state change, per the delegation). The global reduced-motion collapse (transition durations to 1ms) already produces this; the spec states it explicitly so the e2e reduced-motion check asserts a text swap, not a 1ms-visible animation.

**Accessibility of the readout:** the readout is plain text — **not** a live region (announcing every drag tick would spam; the native slider's `aria-valuetext` already announces each value to assistive tech). Sighted and non-sighted users get the same number through different channels; neither gets a motion-only signal (the settled text *is* the signal).

### 11.5 Session delete — confirmation dialog + recommendations

#### 11.5.1 Scope and invariants

- **"Delete" means: remove from this session's gallery. Nothing else.** The files on the phone are unreachable from a browser, and no copy may suggest otherwise; the v1 device-reality line (*"Review here, delete these files on your phone."*, `js/ReviewControls.js:192`) stays in the action bar **and** is restated inside the dialog (§11.5.3).
- **Every deletion goes through the confirmation dialog.** There is no path — tile, detail, or batch — that removes a photo without an explicit confirm press. Cancel is the safe default at every layer.
- **Recommendations never delete.** The recommendation affordance (§11.5.5) only pre-selects; the dialog remains the only gate.
- **No undo in v2** (plan Decision Record): session-scoped harm is low — files re-add by re-picking, the same honesty as "Start over". No undo UI, no toast; the post-delete live-region announcement (§11.5.4) is the confirmation.
- Deleted photos' object URLs are revoked (the `PhotoStore.clear()` pattern, `js/PhotoStore.js:122`), counts/bands/selection update in one pass, and the removal is **instant** — no exit animation (the motion list is unchanged for removals, §11.1 amendment 4).

#### 11.5.2 The three delete affordances

| Affordance | Placement | Styling | Target size |
|---|---|---|---|
| Per-tile "Delete" | New third meta row under every tile (below the filename + percentage chip), right-aligned text button | Neutral: `--text-caption-1` label in `--color-text-secondary` — **not red, not accent** (red on 500 tiles would scream and red's destructive role is confined to the dialog confirm and the detail-view Delete (§11.1 amendment 5); accent is reserved by v2 §4.2). `aria-label "Delete {filename} from this session"` | ≥44×44 coarse / 32px fine (the `band__toggle` density precedent, §6) |
| Detail-view "Delete" | Detail bottom bar (v1 §9d), beside "Download this photo"; the bar flex-wraps at 375px | **Destructive text button** — the one red control outside the dialog, on the **dark stage**: `.btn-text` with color `--color-band-blurry-stage` (`#FF4245`, 5.23 on `--color-stage`, §4.9 pair 30 — the same surface-switch the stage chips already make; the white-surface red `#BB1125` would measure only ≈2.75:1 on the stage). HIG destructive role in a focused single-photo context | 44px coarse / 36px fine (button metrics); focus ring on the stage uses `--color-stage-text` (v1 §12 rule) |
| Batch "Delete selected" | Action bar actions row, DOM order: Add more · Save HD copies · **Delete selected** · Download selected | Neutral secondary (muted fill, plain label — the danger lives in the dialog, matching the tile's restraint). Disabled at 0 selected (zero-selected precedent) | 44px coarse / 36px fine |

Tile meta consequence (extends §11.2's reflow): tile meta is now three rows — filename (opens detail), percentage chip (same button's second line, opens detail), and the Delete row. Heights are uniform across every tile, so the grid never jumps; the row is 44px tall on coarse pointers (the meta area already is, `css/style.css:923` base rule per §6).

#### 11.5.3 The confirmation dialog (one dialog, all triggers)

**Pattern:** the existing detail-view dialog machinery (`role="dialog"` + `aria-modal` on the panel, container labelled, panel-scoped Tab trap, Escape closes, focus return — verified `js/ResultsView.js:440–737`), which itself implements the APG Dialog pattern (fetched 2026-11-05). Reused as a component, not copied per-callsite.

**Visual:** white card (`--color-surface`, hairline, `--radius-lg`, `--shadow-floating`, 20px padding), over `--color-scrim`. Centered card at **max-width 400px on both breakpoints** — a confirm dialog is compact; on mobile it floats as a card with 16px margins rather than becoming a full-screen sheet. Entrance: the §4.6 modal entrance (v1 §6.2: rise 24px + fade mobile / fade + scale 0.98→1 desktop, `--duration-slow`).

**Content (exact copy):**

- Title (`--text-title-3`, `aria-labelledby` target): **"Delete {N} photos from this session?"** — singular: "Delete 1 photo from this session?" (a count, never "these photos" — the user must know the size of what they confirm; v1 §13 numbers rule).
- Body (`--text-subhead`, `--color-text-secondary`, `aria-describedby` target): **"{N} photos will be removed from this review session. Files on your phone aren't touched — to free space, delete these filenames on your phone."** — singular: **"{filename} will be removed from this review session. The file on your phone isn't touched — to free space, delete it on your phone."**
- Filenames disclosure (N > 1): the §9e `<details>` pattern — summary **"See the {N} filenames"**, list in `--font-mono`, `--text-caption-1`. Collapsed by default; expanded state is per-dialog (never persisted). For N = 1 the filename is inline in the body (mono) instead — the dialog is where filenames are read *before* they leave the gallery, which is what makes the honest line actionable.
- Buttons, right-aligned row: **[Cancel]** — secondary (muted fill, `--color-text` label) — and **[Delete]** — the **destructive text button**: `.btn-text` with color `--color-band-blurry-text` (`#BB1125` on the white card, §4.9 pair 20: 6.52 ✓), inheriting every `.btn-text` state (hover underline pointer-only, pressed opacity 0.7, disabled 0.4, 44px coarse / 36px fine, §5's one-token rule). Red text, **never** the accent fill — HIG Buttons (fetched 2026-11-05): a destructive action must not take the primary role even when most likely; and the HIG alert rendering of destructive is red text. Zero new hex (R1b acceptance).

**Focus management (APG, explicitly):**

1. On open, focus moves to **Cancel** — the least destructive action (APG: "if a dialog contains the final step in a process that is not easily reversible… set focus on the least destructive action") and the plan's "cancel is the safe default".
2. Tab / Shift+Tab cycle inside the dialog only (the verified trap).
3. **Escape = Cancel. Scrim click = Cancel.** There is no confirm shortcut — Return activates the *focused* button (Cancel), never Delete by default.
4. On cancel: the dialog closes, focus returns to the invoking control (tile Delete button, detail Delete, or "Delete selected"), which still exists.
5. On confirm: the dialog closes, deletion executes, and focus moves by the fallback chain in §11.5.4 (the invoking control often no longer exists — APG's "focus returns… unless the invoking element no longer exists").
6. When opened from the detail view, the dialog stacks over the detail modal (APG dialog-on-dialog); on cancel focus returns to the detail's Delete button, on confirm both close.

#### 11.5.4 After a confirmed deletion

- **State:** the records leave the store; their object URLs (thumbnail, stage) are revoked; selection drops the removed ids; counts ("N selected · N total"), band counts, and the summary all recompute in one pass. A band that empties renders its header with "0 — No photos in this band" (v1 §8.1, never hidden silently). Skipped records are deletable too (they are session records); the skipped notice does not resurrect them.
- **Rendering:** tiles re-render in place — **no exit animation** (§11.5.1); the band sections do not re-run the reveal motion (the §8.3 tuning precedent: re-banding is instant).
- **Announcement (spec answer: yes, it fires):** one polite live-region message — **"{N} photos removed from this session."** / singular **"{filename} removed from this session."** — then silence. If the removed photos were selected, the existing selection-summary announcement ("3 selected") may also fire; both are one-shot facts, allowed. No toast, no undo affordance, no timer.
- **Focus fallback chain** (first existing wins): the next remaining tile's meta button in the same band → that band's header toggle → the header "Start over" button (always present on results). This satisfies APG's "focus is set on another element that provides logical work flow" when the invoker is gone.

#### 11.5.5 Recommendations — the Blurry band is the recommended-for-deletion set

The plan defines the recommendation set exactly: **every photo in the Blurry band** (score < `SCORE_BLURRY_MAX` = 40, `js/Thresholds.js:94`; threshold tuning is a v3 feature, so the set is stable in v2). Two affordances, both honest, neither able to delete:

- **Band-header action (one-tap select):** the Blurry band's header toggle (the existing "Select all"/"Deselect" text button, `js/ResultsView.js:175–186`) is labeled **"Select all recommended ({N})"** where {N} is the band's current photo count, flipping to **"Deselect"** when all of them are selected — same selection mechanics, a label that teaches what the band means. Other bands keep "Select all". The header flex-wraps at 375px (chip + count row, action row) so the longer label never truncates. A recommendation banner was considered and rejected (§11.8, note 3): the band header already groups exactly this set — a second surface would duplicate it.
- **Per-tile badge:** a small **"Suggested"** label on every Blurry tile's photo, top-left corner (the selection checkmark owns the top-right, so the two never collide): `--text-caption-2` in `--color-text-secondary` on a `--color-surface` pill with a hairline border and `--radius-sm` — meaning carried by **text**, never color alone (inclusive-color rule). It is `aria-hidden` decoration; the tile button's accessible name gains the fact directly: `aria-label "{filename}, suggested for deletion"` when the photo is in the Blurry band. The badge is **percentage-informed by construction** — it renders precisely when the tile's chip shows a percentage below the 40% blurry cut, and never on skipped photos.
- **Invariants:** selecting (by any affordance, including this one) never removes anything; the dialog is the only gate (§11.5.1). The recommendation set recomputes with the bands — if photos are deleted and the Blurry band empties, its header still renders with "0" and the action disappears with the empty band's grid (the empty-band rule).

#### 11.5.6 States

| State | What renders |
|---|---|
| Idle | Affordances per §11.5.2; Blurry header shows "Select all recommended ({N})" |
| Dialog open | Scrim + card; content per §11.5.3; focus on Cancel; page behind inert |
| Confirm pressed | Dialog closes; removal executes instantly; announcement (§11.5.4); focus per fallback chain |
| Cancel (button, Escape, or scrim) | Dialog closes; **nothing changed**; focus returns to the invoker |
| Band emptied | Header "0 · No photos in this band"; no badge, no action; counts consistent |
| All recommended selected | Toggle reads "Deselect"; the selection is exactly the Blurry band |

### 11.6 Motion and accessibility for all three features

#### 11.6.1 Motion — complete inventory of what R4/R5/R6 may add

| Motion | Where | Spec | Status |
|---|---|---|---|
| Resolution number-slide | Converter Output readout (per-photo) | §11.4 — translateY in a clipped window, `--duration-standard`, `--ease-standard`, transform-only, direction = delta | **New** — the one sanctioned addition (§11.1) |
| Converter panel entrance | Detail-view panel | Fade only, `--duration-standard` (notice-card entrance, v1 §8.2) | Existing |
| Confirm/batch dialog entrance | Delete dialog, batch dialog | §4.6 modal entrance (v1 §6.2: rise 24px + fade mobile / fade + scale 0.98→1 desktop, `--duration-slow`) | Existing |
| Spinner | "Upscaling…" apply button; batch progress label | 16px inline, 1s linear — the one permitted loop, with its text label | Existing |
| Determinate progress | Batch conversion ("3 of 12") | `transform: scaleX()`, track `--color-track`, accent fill, `--duration-standard` between updates (analysis pattern, v1 §8.2) | Existing |
| Button press | Every new button | scale(0.98) + fill shift, `--duration-fast` | Existing |
| Tile selection (via "Select all recommended") | Results grid | Checkmark badge scales, `--duration-standard` | Existing |
| Tile removal, dialog dismissal, panel collapse | All three features | **Instant — no motion** | Explicit none |

Nothing loops beyond the spinner; nothing bounces; nothing animates layout properties.

#### 11.6.2 Focus management (summary of every new rule)

- **Delete dialog** — open → Cancel; Tab/Shift+Tab contained; Escape and scrim = Cancel; close → invoking control, or the §11.5.4 fallback chain when removal removed it (APG, fetched 2026-11-05).
- **Batch converter dialog** — open → the factor slider; Done state → the "Done" button; close → "Save HD copies". Same trap, same Escape = cancel while idle.
- **Per-photo converter panel** — lives inside the existing detail dialog, so the proven trap (`js/ResultsView.js:704–737`) contains it; open panel → slider; Cancel → "Save HD copy"; the focus-parking rule for disabled controls carries (":667–686") so the Tab trap survives busy states.
- **No new traps, no roving tabindex, no positive tabindex anywhere** — every new control is a native `button` / `input[type=range]` / `details` in DOM order.

#### 11.6.3 Keyboard reachability (per feature)

- **Percentage:** display-only — nothing to operate; the subtitle and chips are plain flow text.
- **Converter:** "Save HD copy" and "Save HD copies" are buttons in DOM order; the slider is a native range (arrows ±0.5, Home/End to limits, `aria-valuetext "1.5×"`); apply/Cancel/Done/Try again are buttons; the filenames `details` in the delete dialog is natively keyboard-operable.
- **Delete:** per-tile Delete is a real button between the meta button and the next tile's controls; the dialog's Cancel/Delete are buttons; Escape is bound at the dialog level (the existing panel-scoped keydown pattern).
- **Recommendations:** "Select all recommended ({N})" is the existing band toggle (a button); the Suggested badge is `aria-hidden` decoration whose meaning is duplicated in the tile's accessible name.

#### 11.6.4 Live-region announcements (the single polite region, `index.html:98`)

| Event | Announcement | When |
|---|---|---|
| Per-photo conversion done | "IMG_4187-hd.jpg saved — 6048 × 8064." | once, on download |
| Batch conversion start / done | "Upscaling 12 photos." → "12 HD copies saved." | once each (the download flow's pattern, `js/ReviewControls.js:236,251`) |
| Batch partial failure | "Saved 7 of 12 HD copies." | once |
| Deletion done | "12 photos removed from this session." / "{filename} removed from this session." | once, after confirm |
| Deletion + selection change | the existing "3 selected" summary announcement may also fire | both are one-shot facts |
| Dialog opening / clamp note / percentage subtitle | **not announced** (static text in flow; the dialog is announced by focus landing in it) | — |

No second live region, no toasts, no timers (§11.1).

#### 11.6.5 Touch targets (§6 rule applied to every new control)

| Control | Coarse pointer | Fine pointer |
|---|---|---|
| Tile "Delete" text button | ≥44×44 | 32px min-height (compact density) |
| Detail "Delete" (destructive text) | ≥44×44 | 36px (button metrics) |
| "Save HD copy" / "Save HD copies" / "Delete selected" | ≥44×44 | 36px |
| Converter slider hit row | ≥44px tall (20px thumb visual) | ≥44px row (unchanged — sliders keep the tall row at every pointer, §8.2 language) |
| Dialog Cancel / Delete / Done / Try again | ≥44×44 | 36px |
| "Select all recommended ({N})" | ≥44×44 (`.btn-text` base) | 32px via `btn-text--compact` where density applies |
| Suggested badge, percentage chip | not targets — never separately interactive | — |

#### 11.6.6 Reduced motion

The global collapse (§12: all durations → 1ms; reveal/rise disabled) covers every new surface. Explicitly: the **resolution number-slide becomes an instant, crossfade-free text swap** (§11.4); dialogs appear without rise/scale; the progress bar's scaleX updates remain (state, not decoration); the spinner persists (state, with its text label). No new reduced-motion code paths are needed beyond what the collapse already does — R5's e2e asserts the readout swap, not a visible animation.

#### 11.6.7 Token mapping — zero new hex (R1b acceptance)

Every new surface composes from §4's tokens; nothing here introduces a color value:

| New element | Tokens (all existing, with certified pairs) |
|---|---|
| Destructive text button (dialog Delete) | `.btn-text` + `color: var(--color-band-blurry-text)` — 6.52 on the white card (pair 20); states inherited |
| Destructive text button (detail Delete, on the stage) | `.btn-text` + `color: var(--color-band-blurry-stage)` — 5.23 on `--color-stage` (pair 30); the surface-switch the stage chips already use |
| Neutral text button (tile Delete) | `.btn-text` + `color: var(--color-text-secondary)` — 6.37 on white (pair 6; the tile meta area is a `--color-surface` surface, §4.1) |
| "Suggested" badge | `--color-surface` pill + `--color-hairline` + `--radius-sm`, label `--color-text-secondary` (6.37 on its opaque surface, pair 6 — contrast is against the pill, never the photo behind) |
| Converter panel | `--color-surface` card + hairline + `--radius-lg`; readout `--color-text` (17.62) / `--color-text-secondary` (6.37); captions `--color-text-muted` (5.17, pair 9) |
| Converter slider | accent fill vs `--color-fill-pressed` (5.39, pair 40); 20px accent thumb; the §10.4 sanctioned hard-stop track |
| Batch progress | `--color-track` + accent fill (6.04, pair 39) |
| Dialogs | `--color-surface` + `--color-scrim` + `--shadow-floating`; title `--color-text`; body `--color-text-secondary`; filenames `--font-mono` `--text-caption-1` |
| Percentage chips / subtitle | unchanged chip tokens (§4.9 pairs 19/23/27; subtitle pair 7) |

The only *component* additions are two `.btn-text` color variants and one badge — compositions, not new tokens. R3's contrast suite can extend its table with rows already certified above; no re-derivation is required.

### 11.7 Wireframes — 375px base and desktop notes

Same wireframe language as v1 §9: ASCII at the 375px mobile base, every element referencing §4's tokens and §11's component specs; desktop notes follow each. Values shown are examples (scores, dimensions, counts).

#### 11.7a Results grid — percentage, recommendation, per-tile delete

```
┌──────────────────────────────────────┐
│ ▪ header: "Results"    [Start over]  │
├──────────────────────────────────────┤
│ Percentages are based on detected    │  §11.2 subtitle — one instance,
│ sharpness.                           │  --text-subhead, secondary
│                                      │
│ (● Blurry) 12 photos                 │  band header (§8.1); toggle
│              [Select all recommended │  wraps beneath at 375px
│               (12)]                  │  (§11.5.5); others: "Select all"
│ ┌─────┐ ┌─────┐ ┌─────┐              │
│ │Sugg.│ │Sugg.│ │Sugg.│              │  "Suggested" badge top-left of
│ │ img │⊕│ img │ │ img │              │  photo; ⊕ check top-right
│ └─────┘ └─────┘ └─────┘              │  (selection unchanged)
│ IMG_4187  IMG_4190  IMG_4203         │  filename, ellipsis
│ ● 23% sharp                          │  chip: dot + "NN% sharp" (§11.2)
│                       [Delete]       │  tile delete row (§11.5.2),
│ (space-32 between bands)             │  right-aligned, secondary
│ (● Needs review) 5 photos [Deselect] │  …tiles identical minus badge
├──────────────────────────────────────┤
│ 3 selected · 24 total                │  action bar (11.7e)
└──────────────────────────────────────┘
```

Desktop (§7.3): identical structure, 7–9 columns; the band header fits chip + count + "Select all recommended (12)" on one line; the Delete row keeps its right alignment; badge size unchanged.

#### 11.7b Detail view with the converter panel (mobile sheet on `--color-stage`)

```
┌──────────────────────────────────────┐
│ [Done]     IMG_4187.jpg     [Select] │
├──────────────────────────────────────┤
│           ┌──────────────┐           │
│           │    photo     │           │
│           └──────────────┘           │
│ ┌──────────────────────────────────┐ │
│ │ Save an HD copy          [Cancel]│ │  white card on the stage
│ │ Original 3024 × 4032             │ │  static, secondary, mono
│ │ Output   6048 × 8064             │ │  ANIMATED (§11.4), mono
│ │ Size  [──────●───────]      2×   │ │  native range 1–4× step 0.5
│ │ This browser supports up to 4×   │ │  clamp note (§11.3.3)
│ │ for this photo.                  │ │
│ │ Upscaled — enlarged, same        │ │  honest label (§11.3.5)
│ │ captured detail.                 │ │
│ │ Saved as IMG_4187-hd.jpg ·       │ │  format line
│ │ JPEG, quality 92                 │ │
│ │ [       Convert and save     ]   │ │  accent primary (only one)
│ │ Saved as a download. It never    │ │  scope caption, muted
│ │ re-enters the review — scores    │ │
│ │ and bands stay with your         │ │
│ │ originals.                       │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ ● 23% sharp · Blurry · 2.1 MB        │  stage chip (§11.2) + size (§11.2)
│ [Delete]   [Download this photo]     │  destructive text + primary;
└──────────────────────────────────────┘  bar wraps at 375px if needed
```

Desktop (§7.3): centered modal 960×640; the panel spans the modal width between stage and bottom bar; chevrons flank the stage at 44×44 on coarse pointers (§6).

#### 11.7c Delete confirmation dialog (mobile centered card; same composition on desktop, max-width 400px)

```
        (scrim --color-scrim)
   ┌────────────────────────────────┐
   │ Delete 12 photos from this     │  --text-title-3
   │ session?                       │
   │ 12 photos will be removed from │  --text-subhead, secondary
   │ this review session. Files on  │
   │ your phone aren't touched — to │
   │ free space, delete these       │
   │ filenames on your phone.       │
   │ ▸ See the 12 filenames         │  <details> collapsed; mono list
   │                                │  (IMG_4187.jpg, IMG_4190.jpg, …)
   │ [Cancel]            [Delete]   │  Cancel = secondary, INITIAL
   └────────────────────────────────┘  FOCUS; Delete = red text
```

Desktop: identical card, centered in the viewport over the scrim; when opened from the detail modal it stacks above it (§11.5.3 item 6).

#### 11.7d Batch converter dialog — three states (same card as 11.7c)

```
 Idle:  │ Save HD copies                   │   Progress: │ Upscaling 3 of 12        │
        │ Saves the 3 selected photos at   │             │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  │
        │ 2× their original size.          │             │ IMG_4211.jpg             │
        │ Size  [──────●───────]     2×    │             │ (bar scaleX, tabular)    │
        │ Upscaled — enlarged, same        │             └──────────────────────────┘
        │ captured detail.                 │
        │ Photos above this browser's      │   Done:     │ 3 HD copies saved.       │
        │ canvas limit save at their       │             │ Saved at a smaller size  │
        │ largest supported size.          │             │ (browser limit): 1.      │
        │ Saved as a download. It never    │             │ [Done]                   │
        │ re-enters the review — scores    │
        │ and bands stay with your         │   (Cancel during idle/failed =
        │ originals.                       │    Escape/scrim/button)
        │ [       Convert and save     ]   │
```

Desktop: same card; the progress bar spans the card width; downloads stream during progress.

#### 11.7e Action bar with the new batch actions

```
├──────────────────────────────────────┤
│ 3 selected · 24 total                │  summary (unchanged)
│ [Add more]    [Save HD copies]       │  secondaries; row flex-wraps
│ [Delete selected]                    │  at 375px (§11.3.4, §11.5.2)
│ [   Download selected    ]           │  primary (accent), unchanged
│ Review here, delete these files on   │  device line (v1 §13, kept)
│ your phone                           │
└──────────────────────────────────────┘
```

Desktop (§7.3): the floating dock; all four buttons on one row, content capped to 1200px; captions under the dock as today.

### 11.8 Acceptance self-check and interpretation notes

**Plan R1b acceptance criteria → where each is satisfied:**

| Acceptance criterion | Where |
|---|---|
| Every new control maps to existing R1 tokens (no new hex) | §11.6.7 — zero new tokens; the destructive/neutral text buttons and the badge are compositions of certified existing values; the one surface-switch (stage red) reuses the existing stage-band-token pattern |
| The animation has named duration/easing and a reduced-motion fallback | §11.4 — *resolution number-slide*: `--duration-standard` 200ms, `--ease-standard` `cubic-bezier(0.25, 1, 0.5, 1)`, translateY-in-clipped-window; reduced motion = instant crossfade-free swap |
| Honest-label copy written; no "enhance"/"magic" wording anywhere | §11.3.5 (exact strings) + §11.1 amendment 6 (standing rule); the percentage side of honesty is §11.2 |
| Wireframes at 375px and desktop for all new surfaces | §11.7a–e, each with a desktop note |

**Plan R1b "must include" → where:** converter panel with 1×–4× slider + live old→new readout (§11.3.2), capability-probe clamp (§11.3.3), honest quality/dimension label (§11.3.5), output naming/format/quality constants (§11.3.1), per-photo + batch placements with progress (§11.3.2, §11.3.4) · slide animation per §4.6 motion tokens + reduced-motion swap (§11.4) · delete dialog with destructive styling, focus containment, "delete on your phone" copy (§11.5.3) and the "select all recommended (N)" + per-tile badge affordances (§11.5.5) · "NN% sharp" format on tiles/detail/band-header decision, skipped "—", explanatory subtitle (§11.2).

**Interpretation decisions recorded for the R4/R5/R6 implementers and the Reviewer** (each is a design decision, not an omission — challenge via the plan's flip conditions, don't silently diverge):

1. **Band headers display no percentage.** A band holds many stored scores; one number would misrepresent them, and the only band-level figures (the 40/60 cuts) belong to the v3 tuning feature. Plan R4's "band headers consistent with tiles" is read as *format consistency wherever a number appears* — not as adding a number where none exists. If the R4 artifact review rejects this reading, the honest fallback is the fixed cut range ("Blurry · below 40% sharp"); no third option.
2. **Tile meta gains a third row** (the Delete control) **and the file-size caption moves to the detail view** — the percentage chip is ≈3× wider than the bare score, and something had to yield; the size is still visible where the delete-on-phone workflow uses it (§11.2, §11.5.2).
3. **No recommendation banner.** The Blurry band header already groups exactly the recommended set; a banner would duplicate a surface the user is standing in. The band action + per-tile badge are the affordances (§11.5.5).
4. **The batch converter has no old→new readout** — N selected photos have N original sizes, and one merged pair would be false; the mandated animation lives in the per-photo panel where both numbers are exact (§11.3.4).
5. **Default factor is 1×** (apply disabled with the helper line): the app never pre-decides an upscale, and the user's first drag produces exactly the mandated old→new moment (§11.3.2).
6. **Delete controls are text labels; no trash icon.** The v1 icon inventory is unchanged (§11.1 amendment 3).
7. **"Start over" keeps its native `confirm()`** (out of R1b scope). Migrating it to the shared dialog is recorded as a backlog-style consistency note, not v2 work (§11.1 amendment 8).
8. **Per-photo conversion shows a busy state, not a determinate bar** — one-shot resampling has no meaningful percent; the batch flow (many items) gets the determinate pattern (§11.3.2, §11.3.4).
9. **A post-delete announcement fires once** — the delegation's open question, answered yes: one polite message, no toast, no undo (§11.5.4).
10. **Capability probe failures degrade silently by design**: max = 1× removes the entry control (absent, not disabled — v1 §11); the fully-clamped photo's story is "the original download is already the largest safe copy" (§11.3.3).

**Self-check against the delegation's honesty constraints:** resampling claims are limited to "enlarged, same captured detail" (§11.3.5) · outputs are downloads only and never re-scored/re-banded (§11.3, §11.3.7) · targets clamp by runtime probe, never hardcoded limits, with a visible clamp note (§11.3.3) · deletion is session-only behind a dialog whose copy names the phone (§11.5.1, §11.5.3) · recommendations never delete (§11.5.1, §11.5.5) · the percentage says "sharp", skipped shows "—", and no raw score remains user-facing (§11.2).
