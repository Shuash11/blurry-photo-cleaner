/**
 * ResultsView — the §9c grouped results grid, tile selection, and the §9d
 * photo detail/review view (design spec §8.1 photo tile, §8.2 detail view,
 * §6.2 band reveal motion).
 *
 * Responsibilities:
 *   - three band sections in fixed order Blurry → Needs review → Sharp,
 *     each with a band-chip heading (h2), a count, and a Select all /
 *     Deselect toggle; empty bands show "No photos in this band" (§8.1)
 *   - a trailing "Skipped" section for photos analysis could not score
 *     (band "skipped") — they are never counted in the three bands, but
 *     their tiles stay visible with the pending "—" chip (plan: never a
 *     silent drop; the §9e analysis-skip notice explains why)
 *   - tiles: photo area button toggles selection (aria-pressed), meta row
 *     button opens the detail view (§8.1 two-target rule)
 *   - selection state for the session; App reads counts/files from here
 *   - photo detail: full-screen sheet on mobile / centered modal on desktop,
 *     full-resolution preview, score chip in stage tokens, per-item
 *     download, Select toggle, prev/next within the photo's band
 *
 * Selection persists across re-renders (e.g. "Add more" re-analysis).
 */

import { BAND_BLURRY, BAND_REVIEW, BAND_SHARP, BAND_SKIPPED } from "./Thresholds.js";
import { triggerAnchorDownload } from "./ReviewControls.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/* §9c: bands render in fixed order, matching the user's task (blurry first). */
const BAND_ORDER = [BAND_BLURRY, BAND_REVIEW, BAND_SHARP];
const BAND_LABELS = {
  [BAND_BLURRY]: "Blurry",
  [BAND_REVIEW]: "Needs review",
  [BAND_SHARP]: "Sharp",
  [BAND_SKIPPED]: "Skipped",
};

/* §6.2 band reveal: sections fade in and rise 8px (--duration-slow);
   inter-item stagger is the --duration-stagger CSS token, at most six
   items. The token is read from computed style once per render
   (readStaggerMs) so the JS delay cannot silently drift from the CSS
   token; STAGGER_FALLBACK_MS only covers a missing/unparseable token and
   must match css/style.css :root. */
const STAGGER_MAX_ITEMS = 6;
const STAGGER_FALLBACK_MS = 50; // == --duration-stagger

const SWIPE_AXIS_MIN_PX = 48;    // minimum travel for a swipe to count
const SWIPE_DOWN_CLOSE_PX = 80;  // downward travel that closes the sheet

export class ResultsView {
  #root;
  #resultsEl = null;
  #noticeSlot = null;
  #bandToggles = new Map(); // band id → "Select all" button element
  #photos = [];
  #selectedIds = new Set();
  #detail;
  #onSelectionChange;

  constructor({ root, callbacks = {} }) {
    this.#root = root;
    this.#onSelectionChange = callbacks.onSelectionChange ?? null;
    this.#detail = new PhotoDetailView({
      onToggleSelect: (photoId) => this.#toggleSelection(photoId),
      isSelected: (photoId) => this.#selectedIds.has(photoId),
    });
  }

  /** §9e notices mount here while results are on screen (App wires it). */
  get noticeSlot() {
    return this.#noticeSlot;
  }

  get selectedCount() {
    return this.#selectedIds.size;
  }

  /** Selected records in store order (App maps these to Files for download). */
  getSelectedPhotos() {
    return this.#photos.filter((photo) => this.#selectedIds.has(photo.id));
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  /**
   * Render the grouped grid for the given store records. Re-renders keep
   * selection (ids are stable). animate=true runs the §6.2 band reveal —
   * used for the analyzing → results transition.
   */
  render(photos, { animate = false } = {}) {
    this.#photos = photos.slice();
    const liveIds = new Set(this.#photos.map((photo) => photo.id));
    for (const id of [...this.#selectedIds]) {
      if (!liveIds.has(id)) {
        this.#selectedIds.delete(id);
      }
    }

    const results = document.createElement("section");
    results.className = "results";
    this.#resultsEl = results;

    const noticeSlot = document.createElement("div");
    noticeSlot.className = "results__notices";
    results.appendChild(noticeSlot);
    this.#noticeSlot = noticeSlot;

    // §6.2: the stagger comes from the --duration-stagger token, read once
    // per render pass and threaded down to the delay math (custom
    // properties cannot be consumed in JS math without a computed read).
    const staggerMs = readStaggerMs();

    let sectionIndex = 0;
    for (const band of BAND_ORDER) {
      const bandPhotos = this.#photos.filter((photo) => photo.band === band);
      results.appendChild(
        this.#buildBandSection(band, bandPhotos, { animate, sectionIndex, staggerMs }),
      );
      sectionIndex += 1;
    }

    const skippedPhotos = this.#photos.filter((photo) => photo.band === BAND_SKIPPED);
    if (skippedPhotos.length > 0) {
      results.appendChild(
        this.#buildBandSection(BAND_SKIPPED, skippedPhotos, { animate, sectionIndex, staggerMs }),
      );
    }

    this.#root.replaceChildren(results);
  }

  #buildBandSection(band, photos, { animate, sectionIndex, staggerMs }) {
    const section = document.createElement("section");
    section.className = `band band--${band}`;
    section.dataset.band = band;
    if (animate) {
      section.classList.add("band--reveal");
      section.style.animationDelay = `${Math.min(sectionIndex, STAGGER_MAX_ITEMS) * staggerMs}ms`;
    }

    const header = document.createElement("header");
    header.className = "band__header";

    // Band name is a heading (§12: h1 app title → h2 band names), styled
    // as the band chip (tint fill, band text color, dot + word).
    const chip = document.createElement("h2");
    chip.className = `band-chip band-chip--${band}`;
    const dot = document.createElement("span");
    dot.className = "band-chip__dot";
    dot.setAttribute("aria-hidden", "true");
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(BAND_LABELS[band]));
    header.appendChild(chip);

    const count = document.createElement("span");
    count.className = "band__count";
    count.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;
    header.appendChild(count);

    section.appendChild(header);

    if (photos.length === 0) {
      // §8.1: an empty band renders its header with "0" and the message —
      // never hidden silently. (The skipped section only renders non-empty.)
      const empty = document.createElement("p");
      empty.className = "band__empty";
      empty.textContent = "No photos in this band";
      section.appendChild(empty);
      return section;
    }

    if (band !== BAND_SKIPPED) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn-text band__toggle";
      this.#bandToggles.set(band, toggle);
      this.#refreshBandToggle(band);
      toggle.addEventListener("click", () => {
        const allSelected = this.#bandAllSelected(band);
        for (const photo of this.#photos.filter((p) => p.band === band)) {
          this.#applySelection(photo.id, !allSelected);
        }
      });
      header.appendChild(toggle);
    }

    const grid = document.createElement("ul");
    grid.className = "photo-grid";
    photos.forEach((photo, index) => {
      grid.appendChild(
        this.#buildTile(photo, { revealIndex: animate ? index : null, staggerMs }),
      );
    });
    section.appendChild(grid);

    return section;
  }

  #buildTile(photo, { revealIndex = null, staggerMs = STAGGER_FALLBACK_MS }) {
    const tile = document.createElement("li");
    tile.className = "tile";
    tile.dataset.id = photo.id;
    if (revealIndex !== null && revealIndex < STAGGER_MAX_ITEMS) {
      tile.style.animationDelay = `${revealIndex * staggerMs}ms`;
    }

    // Two targets, one tile (§8.1): the photo area toggles selection; the
    // meta row opens the detail view.
    const photoBtn = document.createElement("button");
    photoBtn.type = "button";
    photoBtn.className = "tile__photo";
    photoBtn.setAttribute("aria-pressed", this.#selectedIds.has(photo.id) ? "true" : "false");
    photoBtn.setAttribute("aria-label", photo.name);
    const img = document.createElement("img");
    img.src = photo.thumbURL;
    img.alt = ""; // the filename below is the accessible name
    img.width = photo.width;
    img.height = photo.height;
    img.loading = "lazy";
    photoBtn.appendChild(img);
    const check = document.createElement("span");
    check.className = "tile__check";
    check.setAttribute("aria-hidden", "true");
    check.appendChild(this.#icon("check"));
    photoBtn.appendChild(check);
    photoBtn.classList.toggle("is-selected", this.#selectedIds.has(photo.id));
    photoBtn.addEventListener("click", () => this.#toggleSelection(photo.id));
    tile.appendChild(photoBtn);

    const metaBtn = document.createElement("button");
    metaBtn.type = "button";
    metaBtn.className = "tile__meta-btn";
    metaBtn.setAttribute("aria-label", `View ${photo.name}`);

    const filename = document.createElement("span");
    filename.className = "tile__filename";
    filename.textContent = photo.name;
    filename.title = photo.name; // full name recoverable; grid truncates (§4.3)
    metaBtn.appendChild(filename);

    const metaRow = document.createElement("span");
    metaRow.className = "tile__meta-row";
    metaRow.appendChild(this.#buildChip(photo));
    const size = document.createElement("span");
    size.className = "tile__size";
    size.textContent = formatBytes(photo.size);
    metaRow.appendChild(size);
    metaBtn.appendChild(metaRow);

    metaBtn.addEventListener("click", () => this.#openDetail(photo, metaBtn));
    tile.appendChild(metaBtn);

    return tile;
  }

  /** §8.1 score chip: 8px band-color dot + tabular number in band color. */
  #buildChip(photo) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const dot = document.createElement("span");
    dot.className = "chip__dot";
    const num = document.createElement("span");
    num.className = "chip__num";
    if (typeof photo.score === "number" && photo.band && photo.band !== BAND_SKIPPED) {
      chip.classList.add(`chip--${photo.band}`);
      num.textContent = String(photo.score);
    } else {
      chip.classList.add("chip--pending");
      num.textContent = "—";
    }
    chip.append(dot, num);
    return chip;
  }

  /* ------------------------------------------------------------------
     Selection
     ------------------------------------------------------------------ */

  #toggleSelection(photoId) {
    const photo = this.#photos.find((p) => p.id === photoId);
    if (!photo) {
      return;
    }
    this.#applySelection(photoId, !this.#selectedIds.has(photoId));
  }

  #applySelection(photoId, selected) {
    if (selected) {
      this.#selectedIds.add(photoId);
    } else {
      this.#selectedIds.delete(photoId);
    }
    const photoBtn = this.#resultsEl?.querySelector(
      `.tile[data-id="${CSS.escape(photoId)}"] .tile__photo`,
    );
    photoBtn?.classList.toggle("is-selected", selected);
    photoBtn?.setAttribute("aria-pressed", selected ? "true" : "false");
    const photo = this.#photos.find((p) => p.id === photoId);
    if (photo && photo.band !== BAND_SKIPPED) {
      this.#refreshBandToggle(photo.band);
    }
    this.#onSelectionChange?.();
  }

  #bandAllSelected(band) {
    const bandPhotos = this.#photos.filter((p) => p.band === band);
    return (
      bandPhotos.length > 0 && bandPhotos.every((p) => this.#selectedIds.has(p.id))
    );
  }

  #refreshBandToggle(band) {
    const toggle = this.#bandToggles.get(band);
    if (!toggle) {
      return;
    }
    toggle.textContent = this.#bandAllSelected(band) ? "Deselect" : "Select all";
  }

  /* ------------------------------------------------------------------
     Detail view (§9d)
     ------------------------------------------------------------------ */

  #openDetail(photo, trigger) {
    // Navigation stays inside the photo's own group (§9d: chevrons disable
    // at the first/last photo of the current band).
    const group = this.#photos.filter((p) => p.band === photo.band);
    this.#detail.open({ photo, group, trigger });
  }

  #icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
  }
}

/* ======================================================================
   PhotoDetailView — the §9d overlay: full-screen sheet on mobile,
   centered modal on desktop. Owns its DOM, focus, gestures, and the
   full-resolution object-URL lifecycle (created on open/navigate,
   revoked on replace/close — memory rule).
   ====================================================================== */

const STAGE_BAND_CLASS = {
  [BAND_BLURRY]: "detail__chip--blurry",
  [BAND_REVIEW]: "detail__chip--review",
  [BAND_SHARP]: "detail__chip--sharp",
};

class PhotoDetailView {
  #callbacks;
  #root = null;
  #panel = null;
  #filenameEl = null;
  #selectBtn = null;
  #selectLabel = null;
  #prevBtn = null;
  #nextBtn = null;
  #hintPrev = null; // mobile "‹ swipe ›" chevron (F4: keyboard-reachable nav)
  #hintNext = null;
  #img = null;
  #chip = null;
  #chipNum = null;
  #chipWord = null;
  #downloadBtn = null;
  #downloadLabel = null;
  #spinner = null;
  #doneBtn = null; // focus parking spot when a focused control self-disables
  #group = [];
  #photo = null;
  #trigger = null;
  #stageURL = null;
  #busy = false;
  #touchStart = null;

  constructor({ onToggleSelect, isSelected }) {
    this.#callbacks = { onToggleSelect, isSelected };
  }

  get isOpen() {
    return this.#root !== null;
  }

  open({ photo, group, trigger }) {
    this.close(); // never two overlays
    this.#photo = photo;
    this.#group = group;
    this.#trigger = trigger ?? null;

    this.#root = this.#buildRoot();
    document.body.appendChild(this.#root);
    this.#showPhoto(photo);
    this.#refreshSelect();
    this.#refreshNav();
    this.#panel.focus({ preventScroll: true });
  }

  close() {
    if (!this.#root) {
      return;
    }
    this.#root.remove();
    this.#root = null;
    this.#panel = null;
    if (this.#stageURL) {
      URL.revokeObjectURL(this.#stageURL);
      this.#stageURL = null;
    }
    this.#photo = null;
    this.#busy = false;
    // §12: focus returns to the originating tile on close.
    if (this.#trigger && document.contains(this.#trigger)) {
      this.#trigger.focus({ preventScroll: true });
    }
    this.#trigger = null;
  }

  /* ------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------ */

  #buildRoot() {
    const root = document.createElement("div");
    root.className = "detail";
    root.addEventListener("click", (event) => {
      if (event.target === root) {
        this.close(); // scrim click (desktop; mobile sheet covers the scrim)
      }
    });

    const panel = document.createElement("section");
    panel.className = "detail__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => this.#onPanelKeydown(event));
    root.appendChild(panel);
    this.#panel = panel;

    const top = document.createElement("header");
    top.className = "detail__top";

    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn-text detail__done";
    done.textContent = "Done";
    done.addEventListener("click", () => this.close());
    this.#doneBtn = done;
    top.appendChild(done);

    const filename = document.createElement("p");
    filename.className = "detail__filename";
    top.appendChild(filename);
    this.#filenameEl = filename;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "btn-primary detail__select";
    const selectLabel = document.createElement("span");
    selectLabel.textContent = "Select";
    select.appendChild(selectLabel);
    const selectCheck = document.createElementNS(SVG_NS, "svg");
    selectCheck.setAttribute("class", "icon detail__select-check");
    selectCheck.setAttribute("aria-hidden", "true");
    const selectUse = document.createElementNS(SVG_NS, "use");
    selectUse.setAttribute("href", "#icon-check");
    selectCheck.appendChild(selectUse);
    select.appendChild(selectCheck);
    // Off state hides the glyph via CSS (.detail__select-check base
    // display:none); SVGElement has no `hidden` IDL attribute, so the old
    // el.hidden = true never set the content attribute. #refreshSelect
    // toggles an is-selected class instead (same pattern as the grid tile).
    select.addEventListener("click", () => {
      this.#callbacks.onToggleSelect?.(this.#photo.id);
      this.#refreshSelect();
    });
    top.appendChild(select);
    this.#selectBtn = select;
    this.#selectLabel = selectLabel;

    panel.appendChild(top);

    const stageWrap = document.createElement("div");
    stageWrap.className = "detail__stage-wrap";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "detail__nav detail__nav--prev";
    prev.setAttribute("aria-label", "Previous photo");
    prev.appendChild(this.#icon("chevron-left"));
    prev.addEventListener("click", () => this.#navigate(-1));
    stageWrap.appendChild(prev);
    this.#prevBtn = prev;

    const stage = document.createElement("div");
    stage.className = "detail__stage";
    const img = document.createElement("img");
    img.className = "detail__img";
    img.alt = ""; // the filename is announced by the dialog label
    stage.appendChild(img);
    stageWrap.appendChild(stage);
    this.#img = img;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "detail__nav detail__nav--next";
    next.setAttribute("aria-label", "Next photo");
    next.appendChild(this.#icon("chevron-right"));
    next.addEventListener("click", () => this.#navigate(1));
    stageWrap.appendChild(next);
    this.#nextBtn = next;

    // §9d: swipe left/right navigates, swipe down closes (mobile).
    stage.addEventListener("touchstart", (event) => this.#onTouchStart(event), { passive: true });
    stage.addEventListener("touchend", (event) => this.#onTouchEnd(event), { passive: true });

    panel.appendChild(stageWrap);

    // §9d mobile: the "‹ swipe ›" hint sits under the stage. Its chevron
    // glyphs double as compact prev/next buttons (same actions and
    // accessible names as the desktop chevrons) so keyboard and AT users
    // can navigate at mobile widths too, where the flanking chevrons are
    // display:none per §9d (HIG: an important gesture gets a visible,
    // accessible alternative).
    const hint = document.createElement("div");
    hint.className = "detail__hint";
    const hintPrev = document.createElement("button");
    hintPrev.type = "button";
    hintPrev.className = "detail__hint-nav";
    hintPrev.setAttribute("aria-label", "Previous photo");
    hintPrev.appendChild(this.#icon("chevron-left"));
    hintPrev.addEventListener("click", () => this.#navigate(-1));
    const hintText = document.createElement("span");
    hintText.className = "detail__hint-text";
    hintText.textContent = "swipe";
    const hintNext = document.createElement("button");
    hintNext.type = "button";
    hintNext.className = "detail__hint-nav";
    hintNext.setAttribute("aria-label", "Next photo");
    hintNext.appendChild(this.#icon("chevron-right"));
    hintNext.addEventListener("click", () => this.#navigate(1));
    hint.append(hintPrev, hintText, hintNext);
    panel.appendChild(hint);
    this.#hintPrev = hintPrev;
    this.#hintNext = hintNext;

    const bottom = document.createElement("footer");
    bottom.className = "detail__bottom";

    const chip = document.createElement("span");
    chip.className = "detail__chip";
    const chipDot = document.createElement("span");
    chipDot.className = "detail__chip-dot";
    chipDot.setAttribute("aria-hidden", "true");
    const chipNum = document.createElement("span");
    chipNum.className = "detail__chip-num";
    const chipWord = document.createElement("span");
    chipWord.className = "detail__chip-word";
    chip.append(chipDot, chipNum, chipWord);
    bottom.appendChild(chip);
    this.#chip = chip;
    this.#chipNum = chipNum;
    this.#chipWord = chipWord;

    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn-primary detail__download";
    const downloadLabel = document.createElement("span");
    downloadLabel.textContent = "Download this photo";
    download.appendChild(downloadLabel);
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    spinner.hidden = true;
    download.appendChild(spinner);
    download.addEventListener("click", () => this.#downloadCurrent());
    bottom.appendChild(download);
    this.#downloadBtn = download;
    this.#downloadLabel = downloadLabel;
    this.#spinner = spinner;

    panel.appendChild(bottom);
    return root;
  }

  #icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
  }

  /* ------------------------------------------------------------------
     State rendering
     ------------------------------------------------------------------ */

  #showPhoto(photo) {
    this.#photo = photo;
    if (this.#stageURL) {
      URL.revokeObjectURL(this.#stageURL);
    }
    // Full-resolution preview straight from the original File (§9d: the
    // stage shows the photo at full resolution, object-fit: contain).
    this.#stageURL = URL.createObjectURL(photo.file);
    this.#img.src = this.#stageURL;
    this.#filenameEl.textContent = photo.name;
    this.#filenameEl.title = photo.name;
    // The dialog CONTAINER carries the accessible name (APG Dialog pattern):
    // role="dialog" + aria-modal live on the panel, so the label must too.
    this.#panel.setAttribute("aria-label", `Reviewing ${photo.name}`);

    // Stage chip (§8.2): dot + number + band word in the stage band tokens.
    const band = photo.band;
    this.#chip.className = "detail__chip";
    if (typeof photo.score === "number" && band && band !== BAND_SKIPPED) {
      this.#chip.classList.add(STAGE_BAND_CLASS[band] ?? "");
      this.#chipNum.textContent = String(photo.score);
      this.#chipWord.textContent = `· ${BAND_LABELS[band]}`;
    } else {
      this.#chipNum.textContent = "—";
      this.#chipWord.textContent = band === BAND_SKIPPED ? "· Skipped" : "";
    }
  }

  #refreshSelect() {
    if (!this.#selectBtn || !this.#photo) {
      return;
    }
    // §9d: "Select" toggles the tile's selection from the detail view; the
    // label becomes "Selected" with a check glyph when on, and the button
    // switches primary → secondary-with-check (§8.1 states). The changing
    // label is the announcement (APG: a button whose label changes is not
    // a toggle button — no aria-pressed here; grid tiles keep their own
    // <button aria-pressed> pattern). The glyph follows an is-selected
    // class, like the grid tile's badge.
    const selected = this.#callbacks.isSelected?.(this.#photo.id) ?? false;
    this.#selectBtn.classList.toggle("btn-primary", !selected);
    this.#selectBtn.classList.toggle("btn-secondary", selected);
    this.#selectBtn.classList.toggle("is-selected", selected);
    this.#selectLabel.textContent = selected ? "Selected" : "Select";
  }

  #refreshNav() {
    const index = this.#group.findIndex((p) => p.id === this.#photo?.id);
    // §9d: chevrons never wrap; they disable at the first/last photo. The
    // state drives both the desktop flanking chevrons and the mobile
    // hint-row chevrons.
    const atStart = index <= 0;
    const atEnd = index === -1 || index >= this.#group.length - 1;
    this.#setDisabled(this.#prevBtn, atStart);
    this.#setDisabled(this.#nextBtn, atEnd);
    this.#setDisabled(this.#hintPrev, atStart);
    this.#setDisabled(this.#hintNext, atEnd);
  }

  /**
   * Focus-robust disable: the moment a focused control is disabled, Chrome
   * drops focus to <body>, which strands it outside this aria-modal panel —
   * the panel-scoped keydown then stops hearing Escape and the Tab trap is
   * dead (focus escaped the dialog while it is still open). When the
   * control being disabled had focus, park it on the Done button: always
   * enabled, always inside the dialog, so focus stays contained (§12) and
   * Tab/Escape keep working from the busy state. Enabling never moves
   * focus. This only changes WHERE focus lands on disable — never WHEN a
   * control disables.
   */
  #setDisabled(button, disabled) {
    if (!button) {
      return;
    }
    const hadFocus = document.activeElement === button;
    button.disabled = disabled;
    if (disabled && hadFocus && this.#doneBtn) {
      this.#doneBtn.focus({ preventScroll: true });
    }
  }

  #navigate(delta) {
    const index = this.#group.findIndex((p) => p.id === this.#photo?.id);
    const nextIndex = index + delta;
    if (index === -1 || nextIndex < 0 || nextIndex >= this.#group.length) {
      return;
    }
    // §9d: navigating swaps the image instantly — no transition.
    this.#showPhoto(this.#group[nextIndex]);
    this.#refreshNav();
    this.#refreshSelect();
  }

  /* ------------------------------------------------------------------
     Select toggle (label/check handled with a callback to the grid)
     ------------------------------------------------------------------ */

  #onPanelKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Focus trap (§12): cycle Tab within the panel while open.
    const focusables = [...this.#panel.querySelectorAll("button:not([disabled])")];
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.#panel.getRootNode().activeElement;
    if (!focusables.includes(active)) {
      // Focus is on the panel itself (the open() landing spot — the only
      // focusable thing inside the panel that is not a button). A plain Tab
      // would reach the first control anyway, but Shift+Tab would escape
      // the dialog backwards; route both to the cycle's endpoints (§12).
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #onTouchStart(event) {
    const touch = event.touches[0];
    this.#touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  #onTouchEnd(event) {
    const start = this.#touchStart;
    this.#touchStart = null;
    if (!start) {
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absY > SWIPE_DOWN_CLOSE_PX && absY > absX) {
      this.close(); // swipe-down closes the sheet (§9d)
    } else if (absX > SWIPE_AXIS_MIN_PX && absX > absY) {
      this.#navigate(dx < 0 ? 1 : -1); // swipe left → next, right → previous
    }
  }

  #downloadCurrent() {
    if (this.#busy || !this.#photo) {
      return;
    }
    this.#busy = true;
    // #setDisabled keeps focus inside the dialog when the clicked button
    // dies (see the helper's comment).
    this.#setDisabled(this.#downloadBtn, true);
    this.#downloadLabel.textContent = "Preparing…";
    this.#spinner.hidden = false;
    triggerAnchorDownload(this.#photo.file);
    // Brief busy state so the button reads as pressed-in-progress (§6.2
    // permits the spinner on download buttons).
    setTimeout(() => {
      this.#busy = false;
      if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
        this.#downloadBtn.disabled = false;
        this.#downloadLabel.textContent = "Download this photo";
        this.#spinner.hidden = true;
      }
    }, 600);
  }
}

/* --------------------------------------------------------------------------
   Shared helpers
   -------------------------------------------------------------------------- */

/** --duration-stagger in ms (see STAGGER_FALLBACK_MS), read off :root. */
function readStaggerMs() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--duration-stagger");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : STAGGER_FALLBACK_MS;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
