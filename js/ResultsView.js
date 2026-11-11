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

import { BAND_BLURRY, BAND_REVIEW, BAND_SHARP, BAND_SKIPPED, BAND_LABELS, MAX_UPSCALE_FACTOR, JPEG_QUALITY, formatPercent, formatBytes, hdOutputSpec, upscaleDimensions, SHARPEN_LEVELS, SHARPEN_DEFAULT, EXPORT_FORMATS, exportName } from "./Thresholds.js";
import { triggerAnchorDownload, triggerAnchorBlobDownload, buildHDSliderRow, buildChoiceRow, ExportChooser } from "./ReviewControls.js";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/* §9c: bands render in fixed order, matching the user's task (blurry first). */
const BAND_ORDER = [BAND_BLURRY, BAND_REVIEW, BAND_SHARP];
/* Display labels live in Thresholds.js (v0.6.0) — the shared source for the
   band sections here, App's announcements, and the download ZIP folders. */
export { BAND_LABELS };

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

/* v0.5.3 FULL-SIZE FOCUS MODE (plan §10, user request): clicking the stage
   photo (or Enter/Space on it) expands the stage over the panel chrome
   (.detail__panel.is-focus, css §4.4 extension) — the top bar stays, the
   converter panel and bottom bar yield, and the before/after wipe stays
   mounted and draggable. Esc or a second activation restores the view. */
const FOCUS_COPY = {
  enter: "View this photo full size",
  exit: "Restore the photo view",
};
const FOCUS_DRAG_SLACK_PX = 6; // a stage press that traveled farther is a drag/swipe, not a click

/* §11.5 file-size caption (detail view): bytes are formatted by the shared
 *  formatBytes in Thresholds.js (v0.7.0 — the export chooser's per-format
 *  size labels need the same compact style, so the helper moved to the
 *  one display-format module the whole app shares). */

export class ResultsView {
  #root;
  #resultsEl = null;
  #noticeSlot = null;
  #bandToggles = new Map(); // band id → "Select all" button element
  #photos = [];
  #selectedIds = new Set();
  #selectionLocked = false; // §11.3.4: true while a batch HD conversion runs
  #detail;
  #onSelectionChange;
  #onDeletePhotos;
  #deleteDialog = null; // §11.5.3: ONE confirmation dialog for every trigger

  constructor({ root, callbacks = {} }) {
    this.#root = root;
    this.#onSelectionChange = callbacks.onSelectionChange ?? null;
    this.#onDeletePhotos = callbacks.onDeletePhotos ?? null;
    this.#detail = new PhotoDetailView({
      onToggleSelect: (photoId) => this.#toggleSelection(photoId),
      isSelected: (photoId) => this.#selectedIds.has(photoId),
      getConverter: callbacks.getConverter ?? null,
      announce: callbacks.announce ?? null,
      onRequestDelete: (photo, trigger) => this.requestDelete([photo.id], trigger),
      // v0.3.0: a downloaded/kept HD copy joins the review (auto-reband);
      // v0.5.3: the payload carries the score context (plan §9).
      onAddHD: callbacks.onAddHDRecord ?? null,
      // v0.5.3 (plan §9): App scores the HD panel's preview blob without
      // storing it, so the panel can show a source → preview rating.
      onScorePreview: callbacks.onScorePreview ?? null,
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

  /**
   * v0.3.0 (user request: "one tap — store all the sharp good quality
   * photos and the selected needs-review photos to be downloaded"): the
   * keepers selection. Every Sharp photo plus the Needs-review photos the
   * user has ALREADY ticked; a Blurry photo is never selected by this.
   * One pass over the photos, then one selection-change sync.
   */
  selectKeepers() {
    const keepers = new Set();
    for (const photo of this.#photos) {
      if (photo.band === BAND_SHARP) {
        keepers.add(photo.id);
      } else if (photo.band === BAND_REVIEW && this.#selectedIds.has(photo.id)) {
        keepers.add(photo.id);
      }
    }
    this.#selectedIds = keepers;
    this.#paintSelection();
    this.#onSelectionChange?.();
  }

  /** Re-paint every tile's selected state from #selectedIds (selectKeepers
   *  swaps the whole set, so per-id patching is not enough). */
  #paintSelection() {
    for (const tile of this.#resultsEl?.querySelectorAll(".tile") ?? []) {
      const photoBtn = tile.querySelector(".tile__photo");
      if (!photoBtn) {
        continue;
      }
      const selected = this.#selectedIds.has(tile.dataset.id);
      photoBtn.classList.toggle("is-selected", selected);
      photoBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    for (const [band, toggle] of this.#bandToggles) {
      const bandPhotos = this.#photos.filter((p) => p.band === band);
      const allSelected = bandPhotos.length > 0 && bandPhotos.every((p) => this.#selectedIds.has(p.id));
      toggle.textContent = allSelected
        ? "Deselect"
        : band === BAND_BLURRY
          ? `Select all recommended (${bandPhotos.length})`
          : "Select all";
    }
  }

  /**
   * §11.3.4: while a batch HD conversion runs, the selection is locked —
   * tiles are inert to selection toggles until done, so the downloads that
   * stream during progress always match the selection the user confirmed.
   * App flips this through ReviewControls' lock callback.
   */
  setSelectionLocked(locked) {
    this.#selectionLocked = locked;
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
    // §11.5.4: re-renders rebuild every band section — stale toggle
    // elements from the previous render (e.g. a band that just emptied
    // after a deletion) must not survive in the map, or the focus
    // fallback chain would try to focus a detached node.
    this.#bandToggles.clear();
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

    // §11.2: the one-instance explanatory subtitle — a single line for the
    // whole screen, directly above the first band header (below the §9e
    // notice slot), never per tile or per band. Plain text in flow: no live
    // region (it does not change), no dismiss control.
    const subtitle = document.createElement("p");
    subtitle.className = "results__subtitle";
    subtitle.textContent = "Percentages are based on detected sharpness.";
    results.appendChild(subtitle);

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
        this.#setBandSelection(band, !this.#bandAllSelected(band));
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
    // §11.5.5: the recommendation fact is carried by the accessible name
    // directly — the "Suggested" badge itself is aria-hidden decoration
    // (meaning by text, never color alone).
    photoBtn.setAttribute(
      "aria-label",
      photo.band === BAND_BLURRY
        ? `${photo.name}, suggested for deletion`
        : photo.name,
    );
    const img = document.createElement("img");
    img.src = photo.thumbURL;
    img.alt = ""; // the filename below is the accessible name
    img.width = photo.width;
    img.height = photo.height;
    img.loading = "lazy";
    photoBtn.appendChild(img);
    // §11.5.5 per-tile badge: every Blurry tile is recommended for
    // deletion. Top-LEFT pill (the selection checkmark owns the top-right,
    // so the two never collide); text-only, aria-hidden — the tile
    // button's accessible name carries the fact (above).
    if (photo.band === BAND_BLURRY) {
      const suggested = document.createElement("span");
      suggested.className = "tile__suggested";
      suggested.setAttribute("aria-hidden", "true");
      suggested.textContent = "Suggested";
      photoBtn.appendChild(suggested);
    }
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
    // §11.2 layout consequence: the percentage chip is ≈3× wider than the
    // bare score, so the file-size caption yields its tile slot (it moves
    // to the detail view per §11.2/§11.5). Tile meta stays two lines:
    // filename, then the percentage chip — uniform across every tile.
    metaRow.appendChild(this.#buildChip(photo));
    metaBtn.appendChild(metaRow);

    metaBtn.addEventListener("click", () => this.#openDetail(photo, metaBtn));
    tile.appendChild(metaBtn);

    // §11.5.2 third meta row: per-tile "Delete" — a NEUTRAL text button
    // (red on 500 tiles would scream; the danger lives in the dialog).
    // Opens the confirmation dialog; it never deletes directly.
    const deleteRow = document.createElement("div");
    deleteRow.className = "tile__delete-row";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-text tile__delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${photo.name} from this session`);
    deleteBtn.addEventListener("click", () => this.requestDelete([photo.id], deleteBtn));
    deleteRow.appendChild(deleteBtn);
    tile.appendChild(deleteRow);

    return tile;
  }

  /**
   * §8.1 score chip with the §11.2 percentage format: 8px band-color dot +
   * "NN% sharp" in band color (tabular-nums so grids of chips align).
   * Skipped/pending keeps the muted dot + "—" — never "0% sharp": a skip
   * has no score (§11.2), while a genuine score of 0 renders "0% sharp".
   */
  #buildChip(photo) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const dot = document.createElement("span");
    dot.className = "chip__dot";
    const num = document.createElement("span");
    num.className = "chip__num";
    if (typeof photo.score === "number" && photo.band && photo.band !== BAND_SKIPPED) {
      chip.classList.add(`chip--${photo.band}`);
      num.textContent = formatPercent(photo.score);
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
    if (this.#selectionLocked) {
      return; // §11.3.4: tiles are inert to selection toggles during a batch conversion
    }
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

  /**
   * v0.5.3 (plan §9, user decision): the band toggle REPLACES the selection
   * — "Select all" makes #selectedIds exactly that band's ids (a previous
   * cross-band selection is cleared, so Download selected can never export
   * a band the user did not just pick); "Deselect" clears that band's ids.
   * Per-tile toggles (#applySelection) still add/remove one id at a time,
   * and selectKeepers still swaps the whole set. The set is swapped in one
   * step, so one repaint + one selection-change sync covers it (the action
   * bar's own debounce collapses the announcement as before).
   */
  #setBandSelection(band, selected) {
    if (this.#selectionLocked) {
      return; // §11.3.4: same lock rule as #applySelection
    }
    const bandIds = this.#photos.filter((p) => p.band === band).map((p) => p.id);
    if (selected) {
      this.#selectedIds = new Set(bandIds);
    } else {
      for (const id of bandIds) {
        this.#selectedIds.delete(id);
      }
    }
    this.#paintSelection(); // every tile + every toggle re-reads the new set
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
    if (this.#bandAllSelected(band)) {
      toggle.textContent = "Deselect";
      return;
    }
    // §11.5.5: the Blurry band IS the recommended-for-deletion set — its
    // one-tap select action teaches what the band means. {N} is the band's
    // current photo count (recomputes with the bands); other bands keep
    // the plain label.
    if (band === BAND_BLURRY) {
      const count = this.#photos.filter((p) => p.band === BAND_BLURRY).length;
      toggle.textContent = `Select all recommended (${count})`;
      return;
    }
    toggle.textContent = "Select all";
  }

  /* ------------------------------------------------------------------
      §11.5 session delete — dialog + confirmed removal
      ------------------------------------------------------------------ */

  /**
   * Open the §11.5.3 confirmation dialog for the given photo ids. Every
   * delete affordance funnels through here (tile row, detail view, batch
   * "Delete selected") — there is no path that removes a photo without an
   * explicit confirm press (§11.5.1).
   */
  requestDelete(ids, trigger = null) {
    const photos = ids
      .map((id) => this.#photos.find((p) => p.id === id))
      .filter(Boolean);
    if (photos.length === 0) {
      return;
    }
    this.#deleteDialog ??= new DeleteConfirmDialog();
    this.#deleteDialog.open({
      photos,
      trigger,
      onConfirm: () => this.#executeDelete(photos),
    });
  }

  /** Action-bar entry point ("Delete selected"): the current selection. */
  requestDeleteSelected(trigger = null) {
    this.requestDelete(
      this.getSelectedPhotos().map((photo) => photo.id),
      trigger,
    );
  }

  /**
   * §11.5.4 confirmed deletion: close the detail view if it is showing a
   * deleted photo (§11.5.3 rule 6 — both close), hand the removal to App
   * (store.remove + re-render + notices + sync + announcement), then apply
   * the focus fallback chain (§11.5.4): the next remaining tile's meta
   * button in the same band → that band's header toggle → the header
   * "Start over" button. The invoker is usually gone by now (APG: "focus
   * is set on another element that provides logical work flow").
   */
  #executeDelete(photos) {
    const bandOfFirst = photos[0]?.band ?? null;
    const ids = new Set(photos.map((photo) => photo.id));
    this.#detail.closeIfPhoto(ids);
    this.#onDeletePhotos?.(ids);
    this.#applyPostDeleteFocus(bandOfFirst);
  }

  #applyPostDeleteFocus(band) {
    if (!band) {
      document.getElementById("start-over-btn")?.focus({ preventScroll: true });
      return;
    }
    const nextMeta = this.#resultsEl?.querySelector(
      `.band--${CSS.escape(band)} .tile__meta-btn`,
    );
    const target =
      nextMeta ??
      this.#bandToggles.get(band) ??
      document.getElementById("start-over-btn") ??
      this.#root.querySelector(".btn-hero");
    target?.focus({ preventScroll: true });
    // Bug fix (2026-11-06, smoke S7): focus() scrolls minimally — the
    // focused element can end up flush with the viewport bottom, leaving
    // the tile's own Delete row behind the fixed action bar. Centering the
    // focused target keeps the whole tile (meta + delete) clear of the bar.
    target?.scrollIntoView?.({ block: "center" });
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
  #sizeEl = null; // §11.5: the file-size caption lives in the detail view
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
  #deleteBtn = null; // §11.5.2 detail "Delete" (destructive red on the stage)
  #doneBtn = null; // focus parking spot when a focused control self-disables
  #bottomEl = null;
  #saveHdBtn = null; // "HD Converter" — renders only when the probe finds a factor above 1× (§11.3.2)
  #hdPanel = null; // the inline converter panel (HDPanelView) while open
  #probeSeq = 0; // guards async probe results against navigation/close races
  #group = [];
  #photo = null;
  #trigger = null;
  #stageURL = null;
  #busy = false;
  #touchStart = null;
  #previewStageURL = null; // v0.3.0: the HD-preview swap on the stage
  #exportChooser = null; // v0.3.0: the per-photo export format chooser
  /* v0.7.0 (user request: "add how many MB when downloading — webp/png/jpg
     sizes vary"): measured per-format output sizes for the chooser, cached
     per photo record (WeakMap → Map formatId → bytes or null). Only the
     NUMBER is cached — the blobs themselves stay downloads-and-forgotten
     (§11.3.7 memory rule); a re-download re-encodes as before. */
  #sizeCache = new WeakMap();
  // v0.4.1 before/after wipe (user request)
  #stageEl = null;
  #afterLayer = null;
  #afterImg = null;
  #wipe = null;
  #beforeLabel = null;
  #afterLabel = null;
  #wipePos = 50;
  #wipeDragging = false;
  #wipeSweepTimers = [];
  // v0.5.3 focus mode (plan §10): the pressed-point tracker feeds the stage
  // click guard — a press that traveled farther than FOCUS_DRAG_SLACK_PX
  // was a wipe drag or a swipe, never a toggle click.
  #focusMode = false;
  #stageDownX = 0;
  #stageDownY = 0;
  #stageDragDist = 0;

  constructor({ onToggleSelect, isSelected, getConverter, announce, onRequestDelete, onAddHD, onScorePreview }) {
    this.#callbacks = { onToggleSelect, isSelected, getConverter, announce, onRequestDelete, onAddHD, onScorePreview };
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
    // §11.3.3: the capability probe runs when the detail view OPENS (not
    // when the converter opens) so the "HD Converter" entry's presence and
    // the Unavailable state are decidable before any converter exists.
    this.#probeHD(photo);
  }

  /**
   * Close the overlay. restoreFocus=false skips the §12 focus return —
   * used by the confirmed deletion path (§11.5.4), where the invoking tile
   * is about to leave the DOM and the §11.5.4 fallback chain owns focus.
   */
  close({ restoreFocus = true } = {}) {
    if (!this.#root) {
      return;
    }
    this.#probeSeq += 1; // orphan any in-flight probe
    this.#setFocusMode(false); // v0.5.3: the next open starts in the normal view
    this.#hdPanel?.destroy();
    this.#hdPanel = null;
    this.#saveHdBtn = null;
    this.#deleteBtn = null;
    this.#root.remove();
    this.#root = null;
    this.#panel = null;
    this.#bottomEl = null;
    if (this.#stageURL) {
      URL.revokeObjectURL(this.#stageURL);
      this.#stageURL = null;
    }
    this.#photo = null;
    this.#busy = false;
    // §12: focus returns to the originating tile on close.
    if (restoreFocus && this.#trigger && document.contains(this.#trigger)) {
      this.#trigger.focus({ preventScroll: true });
    }
    this.#trigger = null;
  }

  /**
   * §11.5.3 rule 6: a confirmed deletion of the photo open in the detail
   * view closes both overlays (skip the focus return — the deleted tile is
   * leaving the DOM; the §11.5.4 fallback chain takes over).
   */
  closeIfPhoto(idSet) {
    if (this.#photo && idSet.has(this.#photo.id)) {
      this.close({ restoreFocus: false });
    }
  }

  /**
   * Run the per-photo capability probe and — when a factor above 1× is
   * supported — render the "HD Converter" secondary entry in the bottom bar
   * (§11.3.2: present only when upscaling is possible; a fully-clamped
   * photo's entry is ABSENT, never disabled). The probe result is cached
   * per photo inside the converter, so re-opening a viewed photo is instant.
   */
  async #probeHD(photo) {
    const converter = this.#callbacks.getConverter?.();
    if (!converter) {
      return;
    }
    const seq = this.#probeSeq;
    const max = await converter.probeMax(photo);
    if (seq !== this.#probeSeq || this.#photo?.id !== photo.id) {
      return; // closed or navigated away while probing
    }
    if (max <= 1) {
      return; // Unavailable (§11.3.6): no button renders at all
    }
    if (this.#saveHdBtn || !this.#bottomEl) {
      return;
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-secondary detail__hd-entry";
    save.textContent = "HD Converter";
    save.addEventListener("click", () => this.#openHDPanel(max));
    // Insert before the primary download (§11.3.2: secondary beside it).
    this.#bottomEl.insertBefore(save, this.#downloadBtn);
    this.#saveHdBtn = save;
  }

  #openHDPanel(maxFactor) {
    if (this.#hdPanel || !this.#photo) {
      return;
    }
    const photo = this.#photo;
    const converter = this.#callbacks.getConverter?.();
    if (!converter) {
      return;
    }
    // §11.3.2: while the panel is open, "Download this photo" demotes to
    // secondary (fill swap only) so exactly one accent fill is on screen.
    this.#downloadBtn.classList.remove("btn-primary");
    this.#downloadBtn.classList.add("btn-secondary");
    this.#hdPanel = new HDPanelView({
      photo,
      maxFactor,
      converter,
      onParkFocus: () => this.#doneBtn?.focus({ preventScroll: true }),
      onAnnounce: (text) => this.#callbacks.announce?.(text),
      onClose: () => this.#closeHDPanel(),
      // v0.3.0: the preview swaps the stage between the original and the
      // converted result (Download/Discard live in the panel).
      onPreview: ({ previewURL }) => this.#showPreviewStage(previewURL),
      // v0.5.3 (plan §9): score the preview blob through App's analyzer
      // (transient — nothing enters the store; the panel shows the number).
      onScorePreview: (blob) => this.#callbacks.onScorePreview?.(blob),
      // v0.3.0: a downloaded/kept HD copy joins the review (auto-reband);
      // v0.5.3: payload { blob, name, analysis, sharpening, original }.
      onAddHD: (payload) => this.#callbacks.onAddHD?.(payload),
    });
    // Inline panel, directly above the bottom bar (§11.3.2).
    this.#panel.insertBefore(this.#hdPanel.el, this.#bottomEl);
    // design-spec-v3 §5.2/§6.2: cap the stage while the panel is open so
    // the panel never overlaps the photo (removed on close / navigation).
    this.#panel.classList.add("has-hd-panel");
    this.#hdPanel.focusSlider();
  }

  /**
   * v0.4.1 BEFORE/AFTER WIPE (user request: "animation must be wipe slider
   * — where is the animation of when the image transitions from blurry to
   * clear"). Showing a preview requires NO download: the converted image
   * layers over the original and an auto-sweep plays (all-Before →
   * all-After → settle centred) so the blurry→clear transition ANIMATES;
   * afterwards the divider is freely draggable (pointer or arrow keys).
   * previewURL=null hides the layers and restores the plain original.
   * The preview URL is OWNED by the HDPanelView (revoked on re-preview /
   * destroy) — this side only points an <img> at it.
   */
  #showPreviewStage(previewURL) {
    if (!this.#afterLayer) {
      return;
    }
    for (const t of this.#wipeSweepTimers) {
      clearTimeout(t);
    }
    this.#wipeSweepTimers = [];

    if (previewURL) {
      if (!this.#previewStageURL) {
        this.#previewStageURL = this.#img.src; // keep the original reference
      }
      this.#afterImg.src = previewURL;
      this.#afterLayer.hidden = false;
      this.#wipe.hidden = false;
      this.#beforeLabel.hidden = false;
      this.#afterLabel.hidden = false;
      this.#stageEl.classList.add("is-comparing");
      const reducedMotion =
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        this.#setWipePos(50, { animate: false });
      } else {
        // The animated blurry→clear sweep, then a centred rest position.
        this.#setWipePos(2, { animate: false });
        this.#stageEl.classList.add("is-animating");
        this.#wipeSweepTimers.push(
          setTimeout(() => this.#setWipePos(98, { animate: true }), 60),
          setTimeout(() => this.#setWipePos(50, { animate: true }), 1150),
          setTimeout(() => this.#stageEl.classList.remove("is-animating"), 1800),
        );
      }
    } else {
      this.#afterLayer.hidden = true;
      this.#afterImg.removeAttribute("src");
      this.#wipe.hidden = true;
      this.#beforeLabel.hidden = true;
      this.#afterLabel.hidden = true;
      this.#stageEl.classList.remove("is-comparing", "is-animating");
      this.#previewStageURL = null;
    }
  }

  #setWipePos(pct, { animate = false } = {}) {
    if (!this.#wipe) {
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    this.#wipePos = clamped;
    if (!animate) {
      this.#stageEl.classList.remove("is-animating");
    }
    this.#afterLayer.style.clipPath = `inset(0 0 0 ${clamped}%)`;
    this.#wipe.style.left = `${clamped}%`;
    this.#wipe.setAttribute("aria-valuenow", String(clamped));
  }

  #onWipePointerDown(event) {
    if (!this.#wipe || this.#wipe.hidden) {
      return;
    }
    this.#wipeDragging = true;
    this.#stageEl.classList.remove("is-animating"); // dragging is instant
    try {
      this.#stageEl.setPointerCapture(event.pointerId);
    } catch {
      /* capture unsupported — the pointermove handler still tracks */
    }
    this.#updateWipeFromClientX(event.clientX);
    event.preventDefault();
  }

  #onWipePointerMove(event) {
    if (!this.#wipeDragging || !this.#wipe || this.#wipe.hidden) {
      return;
    }
    this.#updateWipeFromClientX(event.clientX);
  }

  #onWipePointerUp() {
    this.#wipeDragging = false;
  }

  #updateWipeFromClientX(clientX) {
    const rect = this.#stageEl.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    this.#setWipePos(((clientX - rect.left) / rect.width) * 100);
  }

  /** Arrow keys move the divider 5% (the handle is a real ARIA slider). */
  #onWipeKeydown(event) {
    const step = event.shiftKey ? 20 : 5;
    let next = null;
    if (event.key === "ArrowLeft") {
      next = this.#wipePos - step;
    } else if (event.key === "ArrowRight") {
      next = this.#wipePos + step;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = 100;
    }
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation(); // arrows belong to the divider, not the dialog
      this.#setWipePos(next);
    }
  }

  #closeHDPanel() {
    // v0.3.0: the panel owns the preview URL (destroy revokes it) — the
    // stage must point back at the original BEFORE it dies.
    this.#showPreviewStage(null);
    // design-spec-v3 §5.2: the stage cap class leaves with the panel.
    this.#panel.classList.remove("has-hd-panel");
    this.#hdPanel?.destroy();
    this.#hdPanel = null;
    this.#restoreDownloadRole();
    // Cancel returns focus to "HD Converter" (§11.3.2 focus rule).
    this.#saveHdBtn?.focus({ preventScroll: true });
  }

  /** "Download this photo" is the accent primary again once the panel is gone. */
  #restoreDownloadRole() {
    if (this.#downloadBtn) {
      this.#downloadBtn.classList.add("btn-primary");
      this.#downloadBtn.classList.remove("btn-secondary");
    }
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

    // §11.2/§11.5 layout consequence: the file-size caption yields its grid
    // slot to the wider percentage chip and lives here instead — the detail
    // view is where a photo's full facts belong.
    const nameWrap = document.createElement("div");
    nameWrap.className = "detail__name-wrap";
    nameWrap.appendChild(filename);
    const sizeLine = document.createElement("span");
    sizeLine.className = "detail__size";
    nameWrap.appendChild(sizeLine);
    this.#sizeEl = sizeLine;
    top.appendChild(nameWrap);

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
    // v0.5.3 focus mode (plan §10): the photo is the toggle — a real button
    // role with aria-pressed (the §7 label-change discipline; the
    // .detail__stage > .detail__img child contract is preserved). The click
    // guard lives on the STAGE (below) so the same press works over either
    // wipe layer and never fires after a drag.
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-pressed", "false");
    img.setAttribute("aria-label", FOCUS_COPY.enter);
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.#setFocusMode(!this.#focusMode);
      }
    });
    stage.appendChild(img);
    this.#img = img;

    /* v0.4.1 BEFORE/AFTER WIPE (user request): when a converter preview
       exists, the stage layers the converted image OVER the original,
       clipped from the divider position rightward — drag the divider (or
       use the arrow keys) to wipe between the blurry BEFORE (left) and the
       clear AFTER (right). Created lazily by #showPreviewStage; absent
       entirely until a preview exists (no download required to see it). */
    const afterLayer = document.createElement("div");
    afterLayer.className = "detail__after";
    afterLayer.hidden = true;
    const afterImg = document.createElement("img");
    afterImg.className = "detail__img";
    afterImg.alt = "";
    afterLayer.appendChild(afterImg);
    stage.appendChild(afterLayer);
    this.#afterLayer = afterLayer;
    this.#afterImg = afterImg;

    const wipe = document.createElement("button");
    wipe.type = "button";
    wipe.className = "detail__wipe";
    wipe.hidden = true;
    wipe.setAttribute("role", "slider");
    wipe.setAttribute("aria-label", "Before and after comparison");
    wipe.setAttribute("aria-valuemin", "0");
    wipe.setAttribute("aria-valuemax", "100");
    wipe.setAttribute("aria-valuenow", "50");
    const wipeHandle = document.createElement("span");
    wipeHandle.className = "detail__wipe-handle";
    wipeHandle.setAttribute("aria-hidden", "true");
    wipe.appendChild(wipeHandle);
    stage.appendChild(wipe);
    this.#wipe = wipe;

    const beforeLabel = document.createElement("span");
    beforeLabel.className = "detail__wipe-label detail__wipe-label--before";
    beforeLabel.textContent = "Before";
    beforeLabel.hidden = true;
    const afterLabel = document.createElement("span");
    afterLabel.className = "detail__wipe-label detail__wipe-label--after";
    afterLabel.textContent = "After";
    afterLabel.hidden = true;
    stage.append(beforeLabel, afterLabel);
    this.#beforeLabel = beforeLabel;
    this.#afterLabel = afterLabel;

    stageWrap.appendChild(stage);
    this.#stageEl = stage;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "detail__nav detail__nav--next";
    next.setAttribute("aria-label", "Next photo");
    next.appendChild(this.#icon("chevron-right"));
    next.addEventListener("click", () => this.#navigate(1));
    stageWrap.appendChild(next);
    this.#nextBtn = next;

    // §9d: swipe left/right navigates, swipe down closes (mobile).
    // v0.4.1: while the before/after wipe is showing, the stage drags the
    // divider instead of navigating (gated in the handlers).
    stage.addEventListener("touchstart", (event) => this.#onTouchStart(event), { passive: true });
    stage.addEventListener("touchend", (event) => this.#onTouchEnd(event), { passive: true });

    /* v0.4.1 divider interaction: drag anywhere on the stage, or use the
       divider handle's arrow keys. Pointer capture keeps the drag alive
       outside the stage bounds; touch-action is disabled via
       .is-comparing so vertical scrolling never fights the drag. */
    stage.addEventListener("pointerdown", (event) => this.#onWipePointerDown(event));
    stage.addEventListener("pointermove", (event) => this.#onWipePointerMove(event));
    stage.addEventListener("pointerup", (event) => this.#onWipePointerUp(event));
    stage.addEventListener("pointercancel", (event) => this.#onWipePointerUp(event));
    wipe.addEventListener("keydown", (event) => this.#onWipeKeydown(event));

    // v0.5.3 focus mode (plan §10): click/tap the photo to toggle the
    // full-size view. The press tracker is independent of the wipe
    // handlers (which capture the pointer) — the stage still receives
    // every pointer event, and a press that traveled farther than
    // FOCUS_DRAG_SLACK_PX (a wipe drag or a swipe) never toggles. Clicks
    // on the divider itself stay the wipe's affordance.
    stage.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) {
        return;
      }
      this.#stageDownX = event.clientX;
      this.#stageDownY = event.clientY;
      this.#stageDragDist = 0;
    });
    stage.addEventListener("pointermove", (event) => {
      if (!event.isPrimary || !(event.buttons & 1)) {
        return;
      }
      this.#stageDragDist = Math.max(
        this.#stageDragDist,
        Math.hypot(event.clientX - this.#stageDownX, event.clientY - this.#stageDownY),
      );
    });
    stage.addEventListener("click", (event) => {
      if (event.detail === 0) {
        return; // keyboard-generated click — the img keydown already toggled
      }
      if (event.target.closest(".detail__wipe")) {
        return; // the divider owns its own interaction
      }
      if (this.#stageDragDist > FOCUS_DRAG_SLACK_PX) {
        return; // a wipe drag or a swipe — not a toggle click
      }
      this.#setFocusMode(!this.#focusMode);
    });

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
    // The " · " separator (§11.2: "80% sharp · Blurry") is a space text node
    // + the chipWord's "· " prefix. A space-only text node between flex
    // items is never painted (the flex gap does that), but it keeps the DOM
    // text — and the accessible reading — at "NN% sharp · Blurry" instead
    // of mashing "sharp·".
    chip.append(chipDot, chipNum, document.createTextNode(" "), chipWord);
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

    // §11.5.2: the detail "Delete" — the ONE red control outside the
    // dialog, using the stage band token (--color-band-blurry-stage, 5.23:1
    // on --color-stage; the white-surface red would measure ≈2.75:1 here).
    // It opens the §11.5.3 confirmation dialog; it never deletes directly.
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-text detail__delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (this.#photo) {
        this.#callbacks.onRequestDelete?.(this.#photo, del);
      }
    });
    bottom.appendChild(del);
    this.#deleteBtn = del;

    panel.appendChild(bottom);
    this.#bottomEl = bottom;
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
    // The converter entry and panel belong to the photo they were built
    // for (§11.3.2): a navigation resets both and re-probes — the probe
    // cache inside the converter makes re-visits instant. v0.4.1: the
    // before/after wipe resets too (its preview belongs to the old photo).
    this.#showPreviewStage(null);
    this.#hdPanel?.destroy();
    this.#hdPanel = null;
    // design-spec-v3 §5.2: photo navigation also clears the stage-cap class
    // (same reset group as the panel teardown above).
    this.#panel.classList.remove("has-hd-panel");
    this.#restoreDownloadRole();
    this.#saveHdBtn?.remove();
    this.#saveHdBtn = null;
    if (this.#stageURL) {
      URL.revokeObjectURL(this.#stageURL);
    }
    // Full-resolution preview straight from the original File (§9d: the
    // stage shows the photo at full resolution, object-fit: contain).
    this.#stageURL = URL.createObjectURL(photo.file);
    this.#img.src = this.#stageURL;
    this.#filenameEl.textContent = photo.name;
    this.#filenameEl.title = photo.name;
    this.#sizeEl.textContent = formatBytes(photo.size);
    // The dialog CONTAINER carries the accessible name (APG Dialog pattern):
    // role="dialog" + aria-modal live on the panel, so the label must too.
    this.#panel.setAttribute("aria-label", `Reviewing ${photo.name}`);

    // Stage chip (§8.2 anatomy, §11.2 format): dot + "NN% sharp" + band
    // word in the stage band tokens.
    const band = photo.band;
    this.#chip.className = "detail__chip";
    if (typeof photo.score === "number" && band && band !== BAND_SKIPPED) {
      this.#chip.classList.add(STAGE_BAND_CLASS[band] ?? "");
      this.#chipNum.textContent = formatPercent(photo.score);
      this.#chipWord.textContent = `· ${BAND_LABELS[band]}`;
    } else {
      this.#chipNum.textContent = "—";
      this.#chipWord.textContent = band === BAND_SKIPPED ? "· Skipped" : "";
    }

    // §11.5.2: the Delete control names what it removes.
    this.#deleteBtn?.setAttribute(
      "aria-label",
      `Delete ${photo.name} from this session`,
    );

    // §11.3.3: the probe result must exist to decide the entry's presence.
    this.#probeHD(photo);
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
     v0.5.3 full-size focus mode (plan §10): one class on the panel drives
     the css §4.4 extension — the stage expands, the converter panel and
     bottom bar yield; the wipe, chevrons, hint, and top bar stay. The
     img is the toggle control (role=button + aria-pressed + label swap).
     ------------------------------------------------------------------ */

  #setFocusMode(on) {
    if (!this.#panel || this.#focusMode === on) {
      return;
    }
    this.#focusMode = on;
    this.#panel.classList.toggle("is-focus", on);
    this.#img.setAttribute("aria-pressed", on ? "true" : "false");
    this.#img.setAttribute("aria-label", on ? FOCUS_COPY.exit : FOCUS_COPY.enter);
  }

  /* ------------------------------------------------------------------
     Select toggle (label/check handled with a callback to the grid)
     ------------------------------------------------------------------ */

  #onPanelKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      // v0.4.1: layered surfaces — Escape closes the INNERMOST open
      // surface first. v0.5.3 (plan §10): focus mode is that innermost
      // layer (the converter panel and bottom bar are hidden while
      // focused), so Esc restores the normal view first; the converter
      // panel (visible again) and then the detail view follow as before.
      if (this.#focusMode) {
        this.#setFocusMode(false);
        return;
      }
      if (this.#hdPanel) {
        this.#closeHDPanel();
        return;
      }
      this.close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Focus trap (§12): cycle Tab within the panel while open. The range
    // input of an open converter panel is a focusable control too, so the
    // cycle list includes enabled inputs (native DOM order — no new
    // machinery, §11.6.2). v0.5.3: the stage photo is itself a toggle
    // control (role="button", plan §10) and MUST be a cycle member — left
    // out, the not-in-list fallback routed Tab from the photo back to Done
    // and the mobile hint chevrons became keyboard-unreachable (phase4 P6).
    // display:none surfaces (the converter panel and bottom bar while
    // focus mode is on) are filtered — a hidden control can never hold
    // focus, and wrapping to one would strand the cycle.
    const focusables = [
      ...this.#panel.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), img[role='button']",
      ),
    ].filter((el) => el.getClientRects().length > 0);
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
    if (this.#wipe && !this.#wipe.hidden) {
      return; // v0.4.1: the stage drags the wipe divider, not the gallery
    }
    const touch = event.touches[0];
    this.#touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  #onTouchEnd(event) {
    if (this.#wipe && !this.#wipe.hidden) {
      return; // v0.4.1: wipe mode — never navigate or close on a drag
    }
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

  /**
   * v0.3.0 (user request): downloading one photo ASKS what format — the
   * export chooser (Original / PNG / JPEG / WebP). "original" keeps the
   * v0.1 byte-identical behavior; a re-encode format runs the photo
   * through the converter at 1× and names it via Thresholds.exportName.
   *
   * v0.7.0: the chooser also shows each option's file size (user request:
   * "add how many MB … webp? png? and jpg since its picking what format
   * then the sizes may vary"). The sizes come from #exportSizeProvider —
   * the exact numbers the actual download will produce, not estimates.
   */
  #downloadCurrent() {
    if (this.#busy || !this.#photo) {
      return;
    }
    this.#exportChooser ??= new ExportChooser();
    this.#exportChooser.open({
      trigger: this.#downloadBtn,
      onChoose: (formatId) => this.#runCurrentDownload(formatId),
      sizes: this.#exportSizeProvider(this.#photo),
    });
  }

  /**
   * v0.7.0: the chooser's size source. Returns bytes for a format id, or
   * null when the size cannot be shown (the chooser then renders no size).
   *   - "original" → the source File's own byte size (synchronous truth);
   *   - png/jpeg/webp → the photo is actually encoded at 1× through the
   *     SAME converter path the download runs — so the number shown is the
   *     saved file's real size, not a formula. Measured lazily per open,
   *     cached per photo so re-opening the chooser is instant.
   * A failed measurement resolves null (the chooser shows no size); the
   * download path still runs its own conversion and error handling.
   */
  #exportSizeProvider(photo) {
    return async (formatId) => {
      if (formatId === "original") {
        return Number.isFinite(photo.size) && photo.size >= 0 ? photo.size : null;
      }
      const cached = this.#sizeCache.get(photo)?.get(formatId);
      if (cached !== undefined) {
        return cached;
      }
      const converter = this.#callbacks.getConverter?.();
      if (!converter) {
        return null;
      }
      try {
        const result = await converter.convert(photo, 1, { sharpen: 0, format: formatId });
        const bytes = result.blob.size;
        let cache = this.#sizeCache.get(photo);
        if (!cache) {
          cache = new Map();
          this.#sizeCache.set(photo, cache);
        }
        cache.set(formatId, bytes);
        return bytes;
      } catch {
        return null; // measurement failed — no size label; download still works
      }
    };
  }

  async #runCurrentDownload(formatId) {
    if (this.#busy || !this.#photo) {
      return;
    }
    const photo = this.#photo;
    this.#busy = true;
    // #setDisabled keeps focus inside the dialog when the clicked button
    // dies (see the helper's comment).
    this.#setDisabled(this.#downloadBtn, true);
    this.#downloadLabel.textContent = "Preparing…";
    this.#spinner.hidden = false;
    try {
      if (formatId === "original") {
        triggerAnchorDownload(photo.file);
        // Brief busy window so the button reads as pressed-in-progress
        // (§6.2 permits the spinner; the v0.2.1 behavior, kept because an
        // instant label flip is invisible feedback).
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else {
        const converter = this.#callbacks.getConverter?.();
        if (!converter) {
          throw new Error("Converter unavailable");
        }
        const result = await converter.convert(photo, 1, { sharpen: 0, format: formatId });
        triggerAnchorBlobDownload(result.blob, exportName(photo.name, formatId));
      }
    } catch {
      // A re-encode failure surfaces as a plain no-save; the button
      // recovers below (the §8.2 generic path is disproportionate here).
    } finally {
      this.#busy = false;
      if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
        this.#downloadBtn.disabled = false;
        this.#downloadLabel.textContent = "Download this photo";
        this.#spinner.hidden = true;
      }
    }
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

/**
 * v0.5.3 HD-copy rating rule (plan §9) — THE one copy-rating policy, shared
 * by the HD panel's projected readout (HDPanelView) and App's record add:
 *   - sharpening Off + a completed preview analysis + a scored original →
 *     the copy is a pure enlargement (content unchanged; resampling can
 *     only soften), so the copy KEEPS the original's measured rating
 *     exactly (the snap that fixes the already-clear mis-banding).
 *   - otherwise → the measured preview analysis (sharpening can genuinely
 *     re-band a copy; an unscored analysis stays null — never a fake score).
 * Returns { score, band } or null. `original` is the source record (the
 * panel and App both hold it; it may be null on defensive paths).
 * Exported from this module because App already imports ResultsView and a
 * Thresholds add is outside the v0.5.3 write scope — no import cycle.
 */
export function hdCopyRating({ sharpening, analysis, original }) {
  const level = SHARPEN_LEVELS.find((l) => l.id === sharpening);
  const sharpeningOff = level ? level.amount === 0 : false;
  const originalScored =
    !!original &&
    typeof original.score === "number" &&
    (original.band === BAND_BLURRY || original.band === BAND_REVIEW || original.band === BAND_SHARP);
  if (sharpeningOff && analysis && originalScored) {
    return { score: original.score, band: original.band };
  }
  return analysis ?? null;
}

/* ======================================================================
   HDPanelView — the §11.3.2 inline converter panel of the detail view:
   "Save an HD copy" with the 1×–4× slider, the live old→new readout
   carrying the MANDATED resolution number-slide (§11.4), and the exact
   honesty copy (§11.3.5). Lives inside the detail dialog, above the
   bottom bar; the existing panel-scoped focus trap contains it.
   ====================================================================== */

const HD_PANEL_COPY = {
  heading: "HD Converter",
  cancel: "Cancel",
  apply: "Create preview",
  applyBusy: "Upscaling…",
  helper: "Pick a larger size to save a copy.",
  honesty: "Upscaled — enlarged, same captured detail.",
  scope: "Drag the divider to compare before and after — nothing is saved until you choose. The converted copy can join your review without downloading.",
  clampNote: (max) => `This browser supports up to ${max}× for this photo.`,
  previewBadge: "HD preview — drag the divider",
  downloadPreview: "Download HD copy",
  keepPreview: "Keep in review",
  discardPreview: "Discard",
  done: (name) => `Saved ${name}. The HD copy was added to the review with its own score.`,
  doneKeep: "Added to the review with its own score — no download needed.",
  failed: "Couldn't upscale this photo. Nothing was changed.",
  retry: "Try again",
  announcePreview: (width, height) => `HD preview ready — ${width} × ${height}. Drag the divider to compare, then keep, download, or discard.`,
  announceDownloaded: (name) => `${name} saved and added to the review.`,
  announceKept: "HD copy kept in the review.",
  // v0.5.3 (plan §9) sharpness-readout line: pending while App's analyzer
  // measures the preview blob, then the real projected rating (or an
  // honest could-not-score line — never a fabricated number).
  measuring: "Measuring sharpness…",
  couldNotScore: "HD preview: could not be scored",
};

const FACTOR_LABEL = (factor) => `${factor}×`;

class HDPanelView {
  #photo;
  #maxFactor;
  #converter;
  #onParkFocus;
  #onAnnounce;
  #onClose;
  #onPreview; // v0.3.0: swap the detail stage to the converted result
  #onScorePreview; // v0.5.3: App-owned analyzer scores the preview blob (no store write)
  #onAddHD; // v0.3.0: a downloaded/kept HD copy joins the review (auto-reband)
  #sharpen = SHARPEN_DEFAULT;
  // v0.5.3 (Lead review fix): the sharpening level the CURRENT preview blob
  // was actually built with — set at "Create preview" time. The live radio
  // (#sharpen) may change afterwards; the rating rule and the projected
  // readout must describe the BLOB, never the radio's post-hoc state.
  #appliedSharpenId = SHARPEN_DEFAULT;
  #format = "jpeg";
  #formatEl = null;
  #previewActions = null;
  #previewURL = null; // object URL of the converted preview (revoked on teardown)
  #previewBlob = null;
  #previewName = null;
  #previewApplied = false; // one-shot: Keep/Download apply exactly once per preview
  // v0.5.3 (plan §9): the sharpness readout + the score gate on the
  // preview's Keep/Download controls. The source line is static (record
  // data) — only the preview line needs a live reference.
  #previewLine = null; // "Measuring sharpness…" → "HD preview: …"
  #keepBtn = null;
  #keepDownloadBtn = null;
  #previewAnalysis = null; // { score, band } of the current preview; null until scored/failed
  #previewPending = false; // true while the preview score round-trip is in flight
  #previewSeq = 0; // orphans an in-flight score on re-apply/discard/close

  #el = null;
  #slider = null;
  #applyBtn = null;
  #applyLabel = null;
  #applySpinner = null;
  #cancelBtn = null;
  #helperEl = null;
  #statusEl = null;
  // §11.4 readout pieces
  #outWindow = null;
  #outSizer = null;
  #outLine = null; // the line that most recently slid in (the visible value)
  #factor = 1;
  #busy = false;
  #destroyed = false;

  constructor({ photo, maxFactor, converter, onParkFocus, onAnnounce, onClose, onPreview, onScorePreview, onAddHD }) {
    this.#photo = photo;
    this.#maxFactor = maxFactor;
    this.#converter = converter;
    this.#onParkFocus = onParkFocus ?? null;
    this.#onAnnounce = onAnnounce ?? null;
    this.#onClose = onClose ?? null;
    this.#onPreview = onPreview ?? null;
    this.#onScorePreview = onScorePreview ?? null;
    this.#onAddHD = onAddHD ?? null;
    this.#build();
    // §11.4 initial render: the current target appears WITHOUT animation —
    // motion fires on change, never on entrance.
    this.#setOutput(this.#targetFor(this.#factor), { animate: false });
  }

  get el() {
    return this.#el;
  }

  focusSlider() {
    this.#slider?.focus();
  }

  destroy() {
    this.#destroyed = true;
    if (this.#previewURL) {
      URL.revokeObjectURL(this.#previewURL);
      this.#previewURL = null;
      this.#previewBlob = null;
    }
    this.#el?.remove();
    this.#el = null;
  }

  /* ------------------------------------------------------------------
     DOM (anatomy per §11.3.2, top to bottom)
     ------------------------------------------------------------------ */

  #build() {
    const el = document.createElement("div");
    el.className = "hd-panel";
    this.#el = el;
    // Bug fix (2026-11-06): the panel is inserted INSIDE the detail panel,
    // so an Escape keypress bubbled up to the detail's keydown handler and
    // closed the ENTIRE detail view instead of just the converter. The
    // panel owns Escape: not busy → close the panel only (stopPropagation
    // keeps the detail open); busy → swallow Escape (never interrupt a
    // running conversion, never close the detail either).
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!this.#busy) {
        this.#onClose?.();
      }
    });

    // Head: title + Cancel text button.
    const head = document.createElement("div");
    head.className = "hd-panel__head";
    const title = document.createElement("h3");
    title.className = "hd-panel__title";
    title.textContent = HD_PANEL_COPY.heading;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-text";
    cancel.textContent = HD_PANEL_COPY.cancel;
    cancel.addEventListener("click", () => this.#onClose?.());
    head.append(title, cancel);
    el.appendChild(head);
    this.#cancelBtn = cancel;

    // Readout row: "Original W × H" static · "Output [animated] W′ × H′".
    el.appendChild(this.#buildReadout());

    // v0.5.3 (plan §9): honest sharpness readout, right under the resolution
    // readout — the source's measured rating (record data, always available)
    // and, once "Create preview" scores the blob, the rating the copy will
    // get. Existing .hd-copy styling only.
    el.appendChild(this.#buildSharpnessReadout());

    // Slider row (shared native-range control with the batch dialog).
    const sliderRow = buildHDSliderRow({
      value: this.#factor,
      max: this.#maxFactor,
      register: (input) => {
        this.#slider = input;
      },
      onInput: (factor) => this.#onSliderInput(factor),
    });
    el.appendChild(sliderRow);

    // Clamp note — only when the probe clamps below the 4× ceiling (§11.3.3:
    // the ceiling is always explained, never silently hit).
    if (this.#maxFactor < MAX_UPSCALE_FACTOR) {
      const clamp = document.createElement("p");
      clamp.className = "hd-copy";
      clamp.textContent = HD_PANEL_COPY.clampNote(this.#maxFactor);
      el.appendChild(clamp);
    }

    // Honesty label (plan-mandated framing).
    const honesty = document.createElement("p");
    honesty.className = "hd-copy";
    honesty.textContent = HD_PANEL_COPY.honesty;
    el.appendChild(honesty);

    // v0.3.0 (user request): sharpening — the one step that can genuinely
    // raise edge contrast, so the fresh score can honestly re-band a copy.
    el.appendChild(buildChoiceRow({
      label: "Sharpening",
      name: "hd-sharpen",
      options: SHARPEN_LEVELS,
      value: this.#sharpen,
      onInput: (id) => {
        this.#sharpen = id;
      },
    }));

    // v0.3.0 (user request): export format for the HD copy — PNG / JPEG /
    // WebP; the extension, mime, and format line all follow the choice.
    el.appendChild(buildChoiceRow({
      label: "Format",
      name: "hd-format",
      options: EXPORT_FORMATS.filter((f) => f.id !== "original"),
      value: this.#format,
      onInput: (id) => {
        this.#format = id;
        if (this.#formatEl) {
          this.#formatEl.textContent = this.#formatLine();
        }
      },
    }));

    // Format line: exactly what the download will be named and encoded as.
    const format = document.createElement("p");
    format.className = "hd-copy";
    format.textContent = this.#formatLine();
    el.appendChild(format);
    this.#formatEl = format;

    // Apply: accent-filled primary; disabled at 1× with the helper line
    // (§11.3.2 — a no-op conversion would silently re-encode).
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn-primary hd-panel__apply";
    apply.disabled = true;
    const applyLabel = document.createElement("span");
    applyLabel.textContent = HD_PANEL_COPY.apply;
    const applySpinner = document.createElement("span");
    applySpinner.className = "spinner";
    applySpinner.setAttribute("aria-hidden", "true");
    applySpinner.hidden = true;
    apply.append(applyLabel, applySpinner);
    apply.addEventListener("click", () => this.#apply());
    el.appendChild(apply);
    this.#applyBtn = apply;
    this.#applyLabel = applyLabel;
    this.#applySpinner = applySpinner;

    // Helper line for the disabled 1× state.
    const helper = document.createElement("p");
    helper.className = "hd-copy hd-copy--muted";
    helper.textContent = HD_PANEL_COPY.helper;
    el.appendChild(helper);
    this.#helperEl = helper;

    // Status line (done / failed + Try again) — under the apply button.
    const status = document.createElement("p");
    status.className = "hd-status";
    status.hidden = true;
    el.appendChild(status);
    this.#statusEl = status;

    // v0.4.1 preview action row (user request): Keep in review works with
    // NO download — the copy is rated (shared hdCopyRating rule) and joins
    // the review; the download stays available as an option; Discard throws
    // it away.
    const previewActions = document.createElement("div");
    previewActions.className = "hd-preview__actions";
    previewActions.hidden = true;
    const keepPreview = document.createElement("button");
    keepPreview.type = "button";
    keepPreview.className = "btn-primary";
    keepPreview.textContent = HD_PANEL_COPY.keepPreview;
    keepPreview.addEventListener("click", () => this.#keepPreview());
    const downloadPreview = document.createElement("button");
    downloadPreview.type = "button";
    downloadPreview.className = "btn-secondary";
    downloadPreview.textContent = HD_PANEL_COPY.downloadPreview;
    downloadPreview.addEventListener("click", () => this.#downloadPreview());
    const discardPreview = document.createElement("button");
    discardPreview.type = "button";
    discardPreview.className = "btn-secondary";
    discardPreview.textContent = HD_PANEL_COPY.discardPreview;
    discardPreview.addEventListener("click", () => this.#discardPreview());
    previewActions.append(keepPreview, downloadPreview, discardPreview);
    el.appendChild(previewActions);
    this.#previewActions = previewActions;
    // v0.5.3: Keep/Download wait for the preview score (disabled while the
    // "Measuring sharpness…" round-trip runs); Discard stays available.
    this.#keepBtn = keepPreview;
    this.#keepDownloadBtn = downloadPreview;

    // Scope caption.
    const scope = document.createElement("p");
    scope.className = "hd-copy hd-copy--muted";
    scope.textContent = HD_PANEL_COPY.scope;
    el.appendChild(scope);
  }

  #buildReadout() {
    const photo = this.#photo;
    const row = document.createElement("p");
    row.className = "hd-readout";

    const orig = document.createElement("span");
    orig.className = "hd-readout__group hd-readout__group--orig";
    orig.textContent = `Original ${photo.width} × ${photo.height}`;

    const out = document.createElement("span");
    out.className = "hd-readout__group hd-readout__group--out";
    // The "·" separator survives flex-wrap inside the output group (the
    // stage chip's "· Blurry" prefix pattern).
    const sep = document.createElement("span");
    sep.textContent = "·";
    const label = document.createElement("span");
    label.textContent = "Output";
    const windowEl = document.createElement("span");
    windowEl.className = "hd-readout__window";
    // The sizer is a hidden static line that instantly reflows the window's
    // width to the NEW value (§11.4: digit-count changes never transition).
    const sizer = document.createElement("span");
    sizer.className = "hd-readout__sizer";
    sizer.setAttribute("aria-hidden", "true");
    windowEl.appendChild(sizer);
    out.append(sep, label, windowEl);

    row.append(orig, out);
    this.#outWindow = windowEl;
    this.#outSizer = sizer;
    return row;
  }

  /**
   * v0.5.3 (plan §9): the sharpness-readout block. The source line renders
   * immediately from the record; the preview line stays hidden until
   * "Create preview" has scored the blob (pending text → the projected
   * rating via the shared hdCopyRating rule, so the panel number and the
   * kept copy's tile can never disagree). A Sharp source also carries the
   * "Already sharp" framing — enlarging adds no new captured detail, and
   * with sharpening Off the copy keeps this exact rating.
   */
  #buildSharpnessReadout() {
    const fragment = document.createDocumentFragment();

    const source = document.createElement("p");
    source.className = "hd-copy";
    source.textContent = this.#sourceRatingText();
    fragment.appendChild(source);

    const preview = document.createElement("p");
    preview.className = "hd-copy";
    preview.hidden = true;
    this.#previewLine = preview;
    fragment.appendChild(preview);

    const photo = this.#photo;
    if (photo.band === BAND_SHARP && typeof photo.score === "number") {
      const note = document.createElement("p");
      note.className = "hd-copy";
      note.textContent = `Already sharp — ${photo.score}%. Enlarging keeps the same captured detail — it won't add sharpness.`;
      fragment.appendChild(note);
    }

    return fragment;
  }

  /** The source's rating from its store record — the same "NN% sharp · Band"
   *  form the preview line uses; an unscored source renders the §11.2 "—". */
  #sourceRatingText() {
    const photo = this.#photo;
    if (typeof photo.score === "number" && photo.band && photo.band !== BAND_SKIPPED) {
      return `Source: ${formatPercent(photo.score)} · ${BAND_LABELS[photo.band]}`;
    }
    return "Source: —";
  }

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  #formatLine() {
    // design-spec-v3 §6.12 fix: pass the user's chosen format — the old call
    // derived the spec from the source name only (a JPEG/WebP selection on a
    // PNG source kept showing the PNG line). This is the same hdOutputSpec
    // call the convert path's naming uses, so the readout can never drift
    // from the encode.
    const spec = hdOutputSpec(this.#photo.name, this.#format);
    if (spec.mime === "image/png") {
      return `Saved as ${spec.name} · PNG`;
    }
    if (spec.mime === "image/webp") {
      return `Saved as ${spec.name} · WebP`;
    }
    // "quality 92" derives from the JPEG_QUALITY constant (MAX_FILE_LABEL
    // precedent — the copy can never drift from the enforced value).
    return `Saved as ${spec.name} · JPEG, quality ${Math.round(JPEG_QUALITY * 100)}`;
  }

  #targetFor(factor) {
    // THE one rounding rule (§11.3.2) — same call the converter makes.
    return upscaleDimensions(this.#photo.width, this.#photo.height, factor);
  }

  #onSliderInput(factor) {
    if (this.#busy) {
      return;
    }
    const previous = this.#factor;
    this.#factor = factor;
    // §11.3.6 adjusting: apply enables above 1×; the helper line goes away.
    this.#applyBtn.disabled = factor === 1;
    this.#helperEl.hidden = factor !== 1;
    if (factor !== previous) {
      // §11.4: the Output value slides; direction follows the delta.
      this.#setOutput(this.#targetFor(factor), { animate: true, direction: factor > previous ? 1 : -1 });
    }
  }

  async #apply() {
    if (this.#busy || !this.#converter || this.#factor === 1) {
      return;
    }
    const photo = this.#photo;
    const factor = this.#factor;
    const sharpenLevel = SHARPEN_LEVELS.find((l) => l.id === this.#sharpen) ?? SHARPEN_LEVELS[0];
    this.#appliedSharpenId = sharpenLevel.id; // the blob is built with THIS level
    this.#busy = true;
    this.#setControlsDisabled(true);
    this.#applyLabel.textContent = HD_PANEL_COPY.applyBusy;
    this.#applySpinner.hidden = false;
    this.#setStatus(null); // clear the previous done/failed line
    this.#previewActions.hidden = true;

    try {
      // v0.3.0 preview flow: convert WITHOUT downloading — the result goes
      // to the stage first ("user can see the result first if it's worth
      // downloadable"), then the user chooses Download or Discard.
      const result = await this.#converter.convert(photo, factor, {
        sharpen: sharpenLevel.amount,
        format: this.#format,
      });
      if (this.#destroyed) {
        return;
      }
      if (this.#previewURL) {
        URL.revokeObjectURL(this.#previewURL); // a re-preview replaces the old one
      }
      this.#previewBlob = result.blob;
      this.#previewName = result.name;
      this.#previewURL = URL.createObjectURL(result.blob);
      this.#previewApplied = false; // a fresh preview re-arms Keep/Download
      this.#onPreview?.({ previewURL: this.#previewURL });
      this.#previewActions.hidden = false;
      // v0.5.3 (plan §9): score the preview blob and show the real number
      // before the user can keep/download it (the numbers rule).
      this.#beginPreviewScoring(result.blob);
      this.#setStatus({ text: HD_PANEL_COPY.previewBadge });
      // §11.6.4: one polite announcement, once, on preview ready.
      this.#onAnnounce?.(HD_PANEL_COPY.announcePreview(result.width, result.height));
    } catch {
      if (!this.#destroyed) {
        this.#resetPreviewRating(); // no fresh preview exists — no stale line
        this.#setStatus({ text: HD_PANEL_COPY.failed, retry: true });
      }
    } finally {
      this.#busy = false;
      if (!this.#destroyed) {
        this.#setControlsDisabled(false);
        this.#applyLabel.textContent = HD_PANEL_COPY.apply;
        this.#applySpinner.hidden = true;
        this.#applyBtn.disabled = this.#factor === 1;
      }
    }
  }

  /**
   * v0.5.3 (plan §9): score the fresh preview through App's analyzer and
   * show the real number. Keep/Download wait for it (the rating rule needs
   * the measurement); Discard stays available. The sequence guard orphans a
   * stale result when the user re-applies, discards, or closes mid-flight.
   */
  async #beginPreviewScoring(blob) {
    const seq = ++this.#previewSeq;
    this.#previewAnalysis = null;
    this.#setRatingPending(true);
    let analysis = null;
    try {
      analysis = (await this.#onScorePreview?.(blob)) ?? null;
    } catch {
      analysis = null; // honest fallback — the panel never fabricates a number
    }
    if (this.#destroyed || seq !== this.#previewSeq) {
      return; // superseded by a newer preview / discard / close
    }
    this.#previewAnalysis = analysis;
    this.#setRatingPending(false);
    this.#renderPreviewRating();
  }

  /** Pending gate: "Measuring sharpness…" while Keep/Download are disabled. */
  #setRatingPending(pending) {
    this.#previewPending = pending;
    if (this.#previewLine) {
      this.#previewLine.hidden = false;
      this.#previewLine.textContent = pending ? HD_PANEL_COPY.measuring : "";
    }
    if (this.#keepBtn) {
      this.#keepBtn.disabled = pending;
    }
    if (this.#keepDownloadBtn) {
      this.#keepDownloadBtn.disabled = pending;
    }
  }

  /** The projected rating via the shared rule (panel ⇄ App can't drift). */
  #renderPreviewRating() {
    if (!this.#previewLine) {
      return;
    }
    const rating = hdCopyRating({
      sharpening: this.#appliedSharpenId,
      analysis: this.#previewAnalysis,
      original: this.#photo,
    });
    this.#previewLine.hidden = false;
    this.#previewLine.textContent = rating
      ? `HD preview: ${formatPercent(rating.score)} · ${BAND_LABELS[rating.band]}`
      : HD_PANEL_COPY.couldNotScore;
  }

  /** Drop the preview rating line (failed apply / discard / teardown path). */
  #resetPreviewRating() {
    this.#previewAnalysis = null;
    if (this.#previewLine) {
      this.#previewLine.hidden = true;
      this.#previewLine.textContent = "";
    }
  }

  /** v0.5.3: Keep/Download hand App the full story — the blob, the panel's
   *  sharpening choice, the measured analysis, and the source record (the
   *  shared rating rule's inputs). */
  #notifyAddHD() {
    this.#onAddHD?.({
      blob: this.#previewBlob,
      name: this.#previewName,
      analysis: this.#previewAnalysis,
      sharpening: this.#appliedSharpenId,
      original: this.#photo,
    });
  }

  /** v0.3.0: save the previewed copy — and it joins the review with its
   *  own rating (the auto-reband flow lives in App.#addHDRecord). */
  #downloadPreview() {
    if (this.#previewApplied || this.#previewPending || !this.#previewBlob || !this.#previewName) {
      return;
    }
    this.#previewApplied = true;
    triggerAnchorBlobDownload(this.#previewBlob, this.#previewName);
    this.#notifyAddHD();
    this.#onAnnounce?.(HD_PANEL_COPY.announceDownloaded(this.#previewName));
    this.#setStatus({ text: HD_PANEL_COPY.done(this.#previewName) });
    this.#previewActions.hidden = true;
    // The copy is saved; the preview stays on the stage until the panel
    // closes (the user may want to compare it once more).
  }

  /**
   * v0.4.1 (user request: "you don't need to download in order to see the
   * animation slider"): apply the previewed copy to the REVIEW with no
   * download at all — it joins the band its rating earns.
   */
  #keepPreview() {
    if (this.#previewApplied || this.#previewPending || !this.#previewBlob || !this.#previewName) {
      return;
    }
    this.#previewApplied = true;
    this.#notifyAddHD();
    this.#onAnnounce?.(HD_PANEL_COPY.announceKept);
    this.#setStatus({ text: HD_PANEL_COPY.doneKeep });
    this.#previewActions.hidden = true;
  }

  /** v0.3.0: throw the preview away — restore the original on the stage. */
  #discardPreview() {
    this.#previewSeq += 1; // orphan any in-flight score for the discarded preview
    if (this.#previewURL) {
      URL.revokeObjectURL(this.#previewURL);
      this.#previewURL = null;
    }
    this.#previewBlob = null;
    this.#previewName = null;
    this.#resetPreviewRating();
    this.#onPreview?.({ previewURL: null }); // restore the original stage
    this.#previewActions.hidden = true;
    this.#setStatus(null);
  }

  #setControlsDisabled(disabled) {
    // Focus-robust disable (the detail view's #setDisabled pattern): the
    // moment a focused control disables, park focus on the detail dialog's
    // Done button so the Tab trap and Escape keep working.
    const focused = [...this.#el.querySelectorAll("button, input")].some(
      (control) => control === document.activeElement,
    );
    this.#slider.disabled = disabled;
    this.#applyBtn.disabled = disabled || this.#factor === 1;
    this.#cancelBtn.disabled = disabled;
    if (disabled && focused) {
      this.#onParkFocus?.();
    }
  }

  #setStatus(options) {
    const { text, retry = false } = options ?? {};
    const status = this.#statusEl;
    status.replaceChildren();
    status.hidden = !text;
    if (!text) {
      return;
    }
    status.append(document.createTextNode(text));
    if (retry) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn-text hd-status__retry";
      again.textContent = HD_PANEL_COPY.retry;
      again.addEventListener("click", () => this.#apply());
      status.append(document.createTextNode(" "), again);
    }
  }

  /* ------------------------------------------------------------------
     §11.4 — the mandated resolution number-slide
     ------------------------------------------------------------------ */

  /**
   * Render the Output value. `direction`: +1 = the target grew (incoming
   * rises from below), −1 = it shrank (incoming drops in from above),
   * 0/omitted = no motion (initial render and reduced motion).
   *
   * Mechanics: the window is a one-line clipped box; the outgoing line
   * starts at its CURRENT visual offset (read off computed style, so a
   * change that lands mid-flight restarts from there — §11.4 rapid-change
   * rule: never a stale number, never a queued burst) and slides one line
   * out in the slide direction while the incoming line takes its place.
   * Transform-only; the window's width reflows instantly via the hidden
   * sizer (never transitioned).
   */
  #setOutput(target, { animate = false, direction = 0 } = {}) {
    const text = `${target.width} × ${target.height}`;
    const windowEl = this.#outWindow;
    const reducedMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!animate || direction === 0 || reducedMotion) {
      // Instant, crossfade-free swap (§11.4 reduced-motion rule).
      this.#outSizer.textContent = text;
      this.#clearLines();
      const line = document.createElement("span");
      line.className = "hd-readout__line";
      line.textContent = text;
      windowEl.appendChild(line);
      this.#outLine = line;
      return;
    }

    const lineH = windowEl.clientHeight;
    if (!(lineH > 0)) {
      // Window not laid out (hidden/zero) — degrade to the instant swap.
      this.#setOutput(target, { animate: false });
      return;
    }

    // Current visual offset of the outgoing value (mid-flight aware).
    let offset = 0;
    if (this.#outLine) {
      const transform = getComputedStyle(this.#outLine).transform;
      if (transform && transform !== "none") {
        const ty = Number.parseFloat(transform.slice(transform.lastIndexOf(",") + 1));
        if (Number.isFinite(ty)) {
          offset = ty;
        }
      }
    }

    const outText = this.#outSizer.textContent ?? text;
    this.#clearLines();
    const outLine = document.createElement("span");
    outLine.className = "hd-readout__line";
    outLine.textContent = outText;
    const inLine = document.createElement("span");
    inLine.className = "hd-readout__line";
    inLine.textContent = text;
    outLine.style.transform = `translateY(${offset}px)`;
    inLine.style.transform = `translateY(${offset + direction * lineH}px)`;
    windowEl.append(outLine, inLine);
    // Width reflows to the NEW value instantly (sizer), then the slide runs.
    this.#outSizer.textContent = text;
    void windowEl.offsetWidth; // commit the start positions before transitioning
    outLine.style.transform = `translateY(${-direction * lineH}px)`;
    inLine.style.transform = "translateY(0)";
    this.#outLine = inLine;
  }

  #clearLines() {
    for (const line of [...this.#outWindow.querySelectorAll(".hd-readout__line")]) {
      line.remove();
    }
  }
}
