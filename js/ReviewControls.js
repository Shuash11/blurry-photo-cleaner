/**
 * ReviewControls — the §9c/§8.1 bottom action bar of the results screen.
 *
 * Responsibilities:
 *   - selection summary ("3 selected · 24 total", tabular figures)
 *   - "Add more" (secondary; re-enters intake for newly added files only)
 *   - "Save HD copies" (secondary; opens the §11.3.4 batch converter dialog
 *     over the current selection)
 *   - "Download selected" (primary; sequential anchor downloads of the
 *     original File objects — Decision Record route A, no zip library)
 *   - the §13 device-reality line: the app cannot delete from the phone
 *   - busy state during downloads: primary label "Preparing…" with the one
 *     permitted inline spinner; "Add more" disabled while it runs
 *
 * Selection state itself lives in ResultsView; this bar only displays the
 * count (App pushes updates) and asks the provider for the selected files.
 */

import { EXPORT_FORMATS, EXPORT_FORMAT_DEFAULT, MAX_UPSCALE_FACTOR, SHARPEN_LEVELS, SHARPEN_DEFAULT, exportName, hdOutputSpec } from "./Thresholds.js";

const DOWNLOAD_SPACING_MS = 350; // sequential clicks; probe-downloads.js confirmed every download fires at this spacing
const URL_REVOKE_DELAY_MS = 10000; // anchor downloads start within ms; revoke after use (memory rule), never leak
// UX F8: the selection summary is announced through the polite live region
// only after the count has settled for this long (trailing-edge debounce).
// A band "Select all" re-renders the bar through one setSummary call per
// photo in a single task, so the debounce collapses the burst into ONE
// announcement carrying the final count; a leading-edge throttle would
// announce the stale first count instead. Same 500 ms cadence as
// UploadView's PROGRESS_ANNOUNCE_MIN_MS (one live-region update per beat).
const SELECTION_ANNOUNCE_DEBOUNCE_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FACTOR_LABEL = (factor) => `${factor}×`;

/** One anchor-click + bounded-revoke body shared by both download entries —
 * there is exactly one download mechanism in the app. */
function clickAnchor(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download has started; revoke after use — bounded delay, no leak.
  setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}

/**
 * Save one File via a temporary download anchor. Shared with ResultsView
 * (per-item download in the detail view) so there is exactly one download
 * mechanism in the app.
 */
export function triggerAnchorDownload(file) {
  const url = URL.createObjectURL(file);
  clickAnchor(url, file.name); // original filename is preserved (plan route A)
}

/**
 * Save an in-memory Blob (an HD copy — §11.3 outputs are downloads only)
 * under an explicit filename. The same anchor mechanism as
 * triggerAnchorDownload, parameterized for blobs the store never holds.
 * Used by the per-photo converter panel and the batch converter dialog.
 */
export function triggerAnchorBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  clickAnchor(url, filename);
}

export class ReviewControls {
  #host = null;          // element the bar is mounted into
  #bar = null;
  #summaryEl = null;
  #addMoreBtn = null;
  #hdBtn = null;         // "Save HD copies" (§11.3.4 batch converter entry)
  #hdDialog = null;
  #deleteBtn = null;     // "Delete selected" (§11.5.2 — opens the dialog)
  #keepersBtn = null;    // "Select keepers" (v0.3.0 — Sharp + ticked Needs review)
  #chooser = null;       // v0.3.0: the ExportChooser (Original/PNG/JPEG/WebP)
  #resizeObserver = null; // v0.3.0: keeps --action-bar-h synced to the real bar height
  #downloadBtn = null;
  #downloadLabel = null;
  #spinner = null;
  #selected = 0;
  #total = 0;
  #busy = false;
  #selectionSynced = false; // F8: false until the first setSummary — the initial render never announces
  #selectionAnnounceTimer = null;
  #getSelectedFiles;
  #getSelectedPhotos;
  #getConverter;
  #onAddMore;
  #onSelectKeepers; // v0.3.0: the keepers preset (Sharp + ticked Needs review)
  #onDeleteSelected;
  #announce;
  #externalLockChange; // App-provided: tiles go inert while a batch conversion runs (§11.3.4)

  constructor({ getSelectedFiles, getSelectedPhotos, getConverter, onAddMore, onSelectKeepers, onDeleteSelected, announce, onLockChange }) {
    this.#getSelectedFiles = getSelectedFiles;
    this.#getSelectedPhotos = getSelectedPhotos;
    this.#getConverter = getConverter;
    this.#onAddMore = onAddMore;
    this.#onSelectKeepers = onSelectKeepers ?? null;
    this.#onDeleteSelected = onDeleteSelected ?? null;
    this.#announce = announce;
    this.#externalLockChange = onLockChange ?? null;
  }

  /** Build and mount the bar. host is the fixed-position container's parent. */
  mount(host) {
    if (this.#bar) {
      return;
    }
    this.#bar = this.#buildBar();
    this.#host = host;
    host.appendChild(this.#bar);
    // Bug fix (2026-11-06, smoke S7): the bar's height varies with wrapping
    // (six controls at 375px wrap to ~250px) — the results grid's clearance
    // must track the REAL bar height or the last tiles end up behind it and
    // their controls are untappable. The observer writes the live height to
    // --action-bar-h; .results consumes it for its bottom padding.
    this.#resizeObserver = new ResizeObserver(() => {
      const h = Math.ceil(this.#bar.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--action-bar-h", `${h}px`);
    });
    this.#resizeObserver.observe(this.#bar);
    this.#resizeObserver.observe(document.documentElement);
    this.#refresh();
  }

  unmount() {
    this.#bar?.remove();
    this.#bar = null;
    this.#summaryEl = null;
    this.#addMoreBtn = null;
    this.#keepersBtn = null;
    this.#hdBtn = null;
    this.#deleteBtn = null;
    this.#downloadBtn = null;
    this.#downloadLabel = null;
    this.#spinner = null;
    this.#busy = false;
    this.#hdDialog?.close();
    this.#hdDialog = null;
    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }
    document.documentElement.style.removeProperty("--action-bar-h");
    // F8: drop any pending selection announcement and forget the sync — a
    // fresh results session ("Add more", start-over) is silent until the
    // user drives a count change.
    if (this.#selectionAnnounceTimer !== null) {
      clearTimeout(this.#selectionAnnounceTimer);
      this.#selectionAnnounceTimer = null;
    }
    this.#selectionSynced = false;
  }

  /** Push new counts; App calls this on every selection change. */
  setSummary(selected, total) {
    // F8: announce only user-driven count changes — never the first sync
    // (initial render, programmatic re-entry) and never a no-op update.
    const isFirstSync = !this.#selectionSynced;
    const countChanged = selected !== this.#selected;
    this.#selectionSynced = true;
    this.#selected = selected;
    this.#total = total;
    this.#refresh();
    if (!isFirstSync && countChanged) {
      this.#scheduleSelectionAnnouncement(selected);
    }
  }

  /* ------------------------------------------------------------------
      Internals
      ------------------------------------------------------------------ */

  /**
   * UX F8: one trailing-edge announcement with the FINAL selected count
   * (e.g. "3 selected") once the count has been stable for
   * SELECTION_ANNOUNCE_DEBOUNCE_MS. Rapid multi-selects and band
   * select-all re-renders reschedule the timer instead of queuing, so the
   * region never receives a burst. Unmounting cancels the pending
   * announcement; the callback additionally refuses to fire into an
   * unmounted bar.
   */
  #scheduleSelectionAnnouncement(selected) {
    if (this.#selectionAnnounceTimer !== null) {
      clearTimeout(this.#selectionAnnounceTimer);
    }
    this.#selectionAnnounceTimer = setTimeout(() => {
      this.#selectionAnnounceTimer = null;
      if (this.#bar === null) {
        return; // bar unmounted while the debounce ran — stay silent
      }
      this.#announce?.(`${selected} selected`);
    }, SELECTION_ANNOUNCE_DEBOUNCE_MS);
  }

  #buildBar() {
    const bar = document.createElement("div");
    bar.className = "action-bar";

    const row = document.createElement("div");
    row.className = "action-bar__row";

    const summary = document.createElement("p");
    summary.className = "action-bar__summary";
    row.appendChild(summary);
    this.#summaryEl = summary;

    const actions = document.createElement("div");
    actions.className = "action-bar__actions";

    const addMore = document.createElement("button");
    addMore.type = "button";
    addMore.className = "btn-secondary";
    addMore.textContent = "Add more";
    addMore.addEventListener("click", () => {
      if (!this.#busy) {
        this.#onAddMore?.();
      }
    });
    actions.appendChild(addMore);
    this.#addMoreBtn = addMore;

    // v0.3.0 (user request): ONE tap selects the keepers — every Sharp
    // photo plus the Needs-review photos the user already ticked. Selection
    // state lives in ResultsView; this is just the affordance.
    const keepers = document.createElement("button");
    keepers.type = "button";
    keepers.className = "btn-secondary";
    keepers.textContent = "Select keepers";
    keepers.addEventListener("click", () => {
      if (!this.#busy) {
        this.#onSelectKeepers?.();
      }
    });
    actions.appendChild(keepers);
    this.#keepersBtn = keepers;

    // §11.3.4: third secondary, DOM order Add more · Save HD copies ·
    // Download selected; disabled at 0 selected (zero-selected precedent).
    const hd = document.createElement("button");
    hd.type = "button";
    hd.className = "btn-secondary";
    hd.textContent = "Save HD copies";
    hd.addEventListener("click", () => this.#openBatchConverter());
    actions.appendChild(hd);
    this.#hdBtn = hd;

    // §11.5.2: "Delete selected" — neutral secondary (the danger lives in
    // the dialog), DOM order Add more · Save HD copies · Delete selected ·
    // Download selected; disabled at 0 selected (zero-selected precedent).
    // The confirmation dialog is the only gate (§11.5.1).
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-secondary";
    del.textContent = "Delete selected";
    del.addEventListener("click", () => {
      if (!this.#busy) {
        this.#onDeleteSelected?.(del);
      }
    });
    actions.appendChild(del);
    this.#deleteBtn = del;

    // Hierarchy pass (2026-11-06): a hairline separates the destructive
    // "Delete selected" from the constructive pair, so the bar reads
    // Add more · Save HD copies | Delete selected | Download selected.
    const divider = document.createElement("span");
    divider.className = "action-bar__divider";
    divider.setAttribute("aria-hidden", "true");
    actions.insertBefore(divider, del);

    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn-primary";
    download.addEventListener("click", () => this.#downloadSelected());
    const label = document.createElement("span");
    label.textContent = "Download selected";
    download.appendChild(label);
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    spinner.hidden = true;
    download.appendChild(spinner);
    actions.appendChild(download);
    this.#downloadBtn = download;
    this.#downloadLabel = label;
    this.#spinner = spinner;
    // v0.3.0: the export chooser (Original / PNG / JPEG / WebP).
    this.#chooser = new ExportChooser();

    row.appendChild(actions);
    bar.appendChild(row);

    // §13 device-reality copy — required near the download action, in the
    // review flow: the app cannot delete files from the phone.
    const note = document.createElement("p");
    note.className = "action-bar__device-note";
    note.textContent = "Review here, delete these files on your phone.";
    bar.appendChild(note);

    return bar;
  }

  #refresh() {
    if (!this.#bar) {
      return;
    }
    if (this.#summaryEl) {
      this.#summaryEl.textContent = `${this.#selected} selected · ${this.#total} total`;
    }
    if (this.#downloadBtn) {
      // §8.1: zero selected keeps the bar usable (selection remains possible);
      // only the primary download action is disabled.
      this.#downloadBtn.disabled = this.#busy || this.#selected === 0;
    }
    if (this.#addMoreBtn) {
      this.#addMoreBtn.disabled = this.#busy;
    }
    if (this.#hdBtn) {
      this.#hdBtn.disabled = this.#busy || this.#selected === 0;
    }
    if (this.#deleteBtn) {
      this.#deleteBtn.disabled = this.#busy || this.#selected === 0;
    }
    if (this.#keepersBtn) {
      this.#keepersBtn.disabled = this.#busy;
    }
  }

  /**
   * v0.3.0: the export chooser names the format — "original" keeps the v0.1
   * byte-identical behavior; a re-encode format runs every selected photo
   * through the converter POOL at 1× (same pixels, chosen codec — parallel,
   * named via Thresholds.exportName). Zero-selected is blocked by the
   * disabled button; this guard is defense in depth.
   */
  #downloadSelected() {
    if (this.#busy) {
      return;
    }
    const photos = this.#getSelectedPhotos?.() ?? [];
    if (photos.length === 0) {
      return;
    }
    this.#chooser.open({
      trigger: this.#downloadBtn,
      onChoose: (formatId) => this.#runDownloads(photos, formatId),
    });
  }

  async #runDownloads(photos, formatId) {
    if (this.#busy || photos.length === 0) {
      return;
    }
    this.#busy = true;
    this.#refresh();
    if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
      this.#downloadLabel.textContent = "Preparing…";
      this.#spinner.hidden = false;
    }
    // §12: download status through the polite live region.
    const n = photos.length;
    this.#announce?.(`Preparing ${n} ${n === 1 ? "photo" : "photos"}`);

    try {
      if (formatId === "original") {
        for (const photo of photos) {
          triggerAnchorDownload(photo.file);
          await sleep(DOWNLOAD_SPACING_MS);
        }
      } else {
        // Re-encode through the pool (parallel): 1× = same pixel size, the
        // chosen codec. Each file downloads as its conversion finishes.
        const convert = this.#getConverter?.();
        if (!convert) {
          throw new Error("Converter unavailable");
        }
        const jobs = photos.map((photo) =>
          convert
            .convert(photo, 1, { sharpen: 0, format: formatId })
            .then((result) => {
              triggerAnchorBlobDownload(result.blob, exportName(photo.name, formatId));
            })
            .catch(() => { /* one failed photo never blocks the rest */ }),
        );
        await Promise.all(jobs);
      }
    } finally {
      this.#busy = false;
      if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
        this.#downloadLabel.textContent = "Download selected";
        this.#spinner.hidden = true;
      }
      this.#refresh();
    }
    this.#announce?.(
      `Saved ${n} ${n === 1 ? "photo" : "photos"}`,
    );
  }

  /**
   * §11.3.4 batch converter: open the modal dialog over the current
   * selection. The dialog runs its own states; the bar locks for the
   * duration via onLockChange (zero-selected is already blocked by the
   * disabled button — this guard is defense in depth).
   */
  #openBatchConverter() {
    if (this.#busy || this.#selected === 0) {
      return;
    }
    const photos = this.#getSelectedPhotos?.() ?? [];
    const converter = this.#getConverter?.();
    if (photos.length === 0 || !converter) {
      return;
    }
    if (!this.#hdDialog) {
      this.#hdDialog = new BatchHDDialog();
    }
    this.#hdDialog.open({
      photos,
      converter,
      trigger: this.#hdBtn,
      announce: (text) => this.#announce?.(text),
      onLockChange: (locked) => {
        this.#busy = locked;
        this.#refresh();
        // §11.3.4: tiles are inert to selection toggles until done — the
        // downloads must match the selection the user confirmed.
        this.#externalLockChange?.(locked);
      },
    });
  }
}

/* ======================================================================
   BatchHDDialog — the §11.3.4 modal dialog: "Save HD copies" over the
   current selection. Same APG dialog machinery as the detail view
   (role="dialog" + aria-modal, labelled, panel-scoped Tab trap, Escape =
   cancel while idle, focus returns to the invoking button) with the
   analysis-batch progress pattern (§11.3.4: determinate bar + "N of M").
   Deliberately NO per-photo old→new readout here — N photos have N
   original sizes; one merged pair would be false (§11.8 note 4).
   ====================================================================== */

/* ── v0.3.0 — shared choice row + export chooser (user requests) ─────────── */

/**
 * The segmented choice row shared by the HD panel (sharpening, format) and
 * the batch dialog (the same two controls): label + one radio-style group.
 * Native radios (keyboard-complete, no custom ARIA) styled as a segmented
 * control. options: [{ id, label }].
 */
export function buildChoiceRow({ label, name, options, value, onInput }) {
  const row = document.createElement("div");
  row.className = "choice-row";

  const labelEl = document.createElement("span");
  labelEl.className = "choice-row__label";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const group = document.createElement("div");
  group.className = "choice-row__group";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  for (const option of options) {
    const id = `${name}-${option.id}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.className = "choice-row__input";
    radio.name = name;
    radio.id = id;
    radio.value = option.id;
    radio.checked = option.id === value;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        onInput?.(option.id);
      }
    });
    const pill = document.createElement("label");
    pill.className = "choice-row__pill";
    pill.setAttribute("for", id);
    pill.textContent = option.label;
    group.append(radio, pill);
  }
  row.appendChild(group);
  return row;
}

/**
 * ExportChooser — the v0.3.0 format picker (user request: "when downloading
 * one photo it asks what format to export"). A compact sheet: Original
 * (byte-identical) / PNG / JPEG / WebP; remembers the last pick for the
 * session (module state, never localStorage — the storage rule). Reuses the
 * confirm-dialog surface (.confirm/.confirm__panel) with option buttons.
 */
let lastExportFormat = EXPORT_FORMAT_DEFAULT;

export class ExportChooser {
  #root = null;
  #trigger = null;

  open({ trigger = null, onChoose }) {
    this.close();
    this.#trigger = trigger ?? null;

    const root = document.createElement("div");
    root.className = "confirm";
    root.addEventListener("click", (event) => {
      if (event.target === root) {
        this.close(); // scrim click = cancel
      }
    });

    const panel = document.createElement("section");
    panel.className = "confirm__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "export-title");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusables = [...panel.querySelectorAll("button:not([disabled])")];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = panel.getRootNode().activeElement;
      if (!focusables.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });
    this.#root = root;

    const title = document.createElement("h2");
    title.id = "export-title";
    title.className = "confirm__title";
    title.textContent = "Choose a download format";
    panel.appendChild(title);

    const note = document.createElement("p");
    note.className = "confirm__text";
    note.textContent = "Original saves the file exactly as it is. The other formats re-encode it at the same pixel size.";
    panel.appendChild(note);

    let firstBtn = null;
    for (const format of EXPORT_FORMATS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary export-choice";
      const label = document.createElement("span");
      label.className = "export-choice__label";
      label.textContent = format.label;
      btn.appendChild(label);
      if (format.id === lastExportFormat) {
        const current = document.createElement("span");
        current.className = "export-choice__hint";
        current.textContent = "last used";
        btn.appendChild(current);
      }
      btn.addEventListener("click", () => {
        lastExportFormat = format.id;
        const choose = onChoose;
        // Focus RETURNS to the invoking button (the trigger survives every
        // chooser use — the destructive dialog is the only flow that skips
        // the restore). This keeps the keyboard flow coherent: the busy
        // state then parks focus on Done from a real in-panel focus.
        this.close();
        choose?.(format.id);
      });
      panel.appendChild(btn);
      firstBtn ??= btn;
    }

    root.appendChild(panel);
    document.body.appendChild(root);
    firstBtn?.focus();
  }

  close({ restoreFocus = true } = {}) {
    if (!this.#root) {
      return;
    }
    this.#root.remove();
    this.#root = null;
    if (restoreFocus && this.#trigger && document.contains(this.#trigger)) {
      this.#trigger.focus({ preventScroll: true });
    }
    this.#trigger = null;
  }
}

const HD_COPY = {
  heading: "Save HD copies",
  honesty: "Upscaled — enlarged, same captured detail.",
  scope: "Preview first — nothing is saved until you choose Download. A downloaded copy is scored fresh and joins the review next to its original.",
  clampNote: "Photos above this browser's canvas limit save at their largest supported size.",
  helper: "Pick a larger size to save a copy.",
  apply: "Convert and save",
  summaryLine: (n, factor) => `Saves the ${n} selected ${n === 1 ? "photo" : "photos"} at ${FACTOR_LABEL(factor)} their original size.`,
  progressLabel: (done, total) => `Upscaling ${done} of ${total}`,
  done: (n) => `${n} HD copies saved.`,
  clamped: (k) => `Saved at a smaller size (browser limit): ${k}.`,
  partial: (k, n) => `Saved ${k} of ${n} HD copies.`,
  failedAll: "Couldn't upscale these photos. Nothing was changed.",
  announceStart: (n) => `Upscaling ${n} ${n === 1 ? "photo" : "photos"}.`,
  announceDone: (n) => `${n} HD copies saved.`,
  announcePartial: (k, n) => `Saved ${k} of ${n} HD copies.`,
};

class BatchHDDialog {
  #root = null;
  #panel = null;
  #body = null;
  #titleEl = null;
  #photos = [];
  #remaining = [];
  #converter = null;
  #trigger = null;
  #announce = null;
  #onLockChange = null;
  #factor = 1;
  #sharpen = SHARPEN_DEFAULT;
  #format = "jpeg";
  #state = "idle"; // "idle" | "processing" | "done" | "failed"
  #slider = null;
  #summaryLine = null;
  #applyBtn = null;
  #helperEl = null;

  open({ photos, converter, trigger, announce, onLockChange }) {
    this.close(); // never two overlays
    this.#photos = photos.slice();
    this.#remaining = photos.slice();
    this.#converter = converter;
    this.#trigger = trigger ?? null;
    this.#announce = announce ?? null;
    this.#onLockChange = onLockChange ?? null;
    this.#factor = 1;
    this.#sharpen = SHARPEN_DEFAULT;
    this.#format = "jpeg";
    this.#state = "idle";

    this.#root = document.createElement("div");
    this.#root.className = "hd-dialog";

    const panel = document.createElement("section");
    panel.className = "hd-dialog__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => this.#onPanelKeydown(event));
    this.#root.appendChild(panel);
    this.#panel = panel;

    const body = document.createElement("div");
    body.className = "hd-dialog__body";
    panel.appendChild(body);
    this.#body = body;

    this.#renderIdle();
    document.body.appendChild(this.#root);
    this.#onLockChange?.(true);
    // §11.6.2: open → the factor slider.
    this.#slider?.focus();
  }

  close() {
    if (!this.#root) {
      return;
    }
    this.#root.remove();
    this.#root = null;
    this.#panel = null;
    this.#body = null;
    this.#slider = null;
    this.#summaryLine = null;
    this.#applyBtn = null;
    this.#state = "idle";
    this.#onLockChange?.(false);
    // §12: focus returns to the invoking "Save HD copies" button.
    if (this.#trigger && document.contains(this.#trigger)) {
      this.#trigger.focus({ preventScroll: true });
    }
    this.#trigger = null;
  }

  /* ------------------------------------------------------------------
     States
     ------------------------------------------------------------------ */

  #renderIdle() {
    const body = this.#body;
    body.replaceChildren();

    const title = document.createElement("h2");
    title.id = "hd-batch-title";
    title.className = "hd-dialog__title";
    title.textContent = HD_COPY.heading;
    body.appendChild(title);
    this.#titleEl = title;
    this.#panel.setAttribute("aria-labelledby", "hd-batch-title");

    const summary = document.createElement("p");
    summary.className = "hd-dialog__lede";
    summary.textContent = HD_COPY.summaryLine(this.#remaining.length, this.#factor);
    body.appendChild(summary);
    this.#summaryLine = summary;

    body.appendChild(buildHDSliderRow({
      value: this.#factor,
      onInput: (factor) => {
        this.#factor = factor;
        this.#summaryLine.textContent = HD_COPY.summaryLine(this.#remaining.length, this.#factor);
        // §11.3.6 idle state: apply disabled at 1× with the helper line.
        this.#applyBtn.disabled = factor === 1;
        this.#helperEl.hidden = factor !== 1;
      },
      register: (el) => { this.#slider = el; },
    }));

    // v0.3.0 (user requests): sharpening + export format for the whole
    // batch — the same choice controls as the per-photo panel.
    body.appendChild(buildChoiceRow({
      label: "Sharpening",
      name: "hd-batch-sharpen",
      options: SHARPEN_LEVELS,
      value: this.#sharpen,
      onInput: (id) => {
        this.#sharpen = id;
      },
    }));
    body.appendChild(buildChoiceRow({
      label: "Format",
      name: "hd-batch-format",
      options: EXPORT_FORMATS.filter((f) => f.id !== "original"),
      value: this.#format,
      onInput: (id) => {
        this.#format = id;
      },
    }));

    const honesty = document.createElement("p");
    honesty.className = "hd-copy";
    honesty.textContent = HD_COPY.honesty;
    body.appendChild(honesty);

    const clamp = document.createElement("p");
    clamp.className = "hd-copy";
    clamp.textContent = HD_COPY.clampNote;
    body.appendChild(clamp);

    const scope = document.createElement("p");
    scope.className = "hd-copy hd-copy--muted";
    scope.textContent = HD_COPY.scope;
    body.appendChild(scope);

    const helper = document.createElement("p");
    helper.className = "hd-copy hd-copy--muted";
    helper.textContent = HD_COPY.helper;
    helper.hidden = false; // idle opens at 1× — apply is disabled
    body.appendChild(helper);
    this.#helperEl = helper;

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn-primary hd-dialog__apply";
    apply.textContent = HD_COPY.apply;
    apply.disabled = true; // default factor is 1× (§11.8 note 5)
    apply.addEventListener("click", () => this.#run());
    body.appendChild(apply);
    this.#applyBtn = apply;
  }

  #renderProcessing(done, total, currentName) {
    const body = this.#body;
    body.replaceChildren();

    const label = document.createElement("p");
    label.className = "hd-progress__label";
    label.textContent = HD_COPY.progressLabel(done, total);
    body.appendChild(label);

    const bar = document.createElement("div");
    bar.className = "hd-progress__bar";
    const fill = document.createElement("div");
    fill.className = "hd-progress__fill";
    fill.style.transform = `scaleX(${total === 0 ? 0 : done / total})`;
    bar.appendChild(fill);
    body.appendChild(bar);

    const name = document.createElement("p");
    name.className = "hd-progress__name";
    name.textContent = currentName ?? "";
    body.appendChild(name);
  }

  #renderDone(savedCount, clampedCount) {
    this.#renderDonePanel(HD_COPY.done(savedCount), clampedCount, null);
  }

  /** v0.3.0 pool edition: per-photo failures no longer abort the batch —
   *  the done panel reports saved vs failed honestly. */
  #renderPartialDone(savedCount, failedCount, clampedCount) {
    this.#renderDonePanel(
      `Saved ${savedCount} of ${savedCount + failedCount} HD copies.`,
      clampedCount,
      failedCount > 0 ? `${failedCount} ${failedCount === 1 ? "photo" : "photos"} couldn't be upscaled.` : null,
    );
  }

  #renderDonePanel(message, clampedCount, failureNote) {
    const body = this.#body;
    body.replaceChildren();

    const done = document.createElement("p");
    done.className = "hd-dialog__lede";
    done.textContent = message;
    body.appendChild(done);

    if (clampedCount > 0) {
      const clamped = document.createElement("p");
      clamped.className = "hd-copy";
      clamped.textContent = HD_COPY.clamped(clampedCount);
      body.appendChild(clamped);
    }

    if (failureNote) {
      const failed = document.createElement("p");
      failed.className = "hd-copy";
      failed.textContent = failureNote;
      body.appendChild(failed);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-primary hd-dialog__apply";
    button.textContent = "Done";
    button.addEventListener("click", () => this.close());
    body.appendChild(button);
    // §11.6.2: Done state → the "Done" button.
    button.focus();
  }

  /* ------------------------------------------------------------------
     Conversion run
     ------------------------------------------------------------------ */

  async #run() {
    if (this.#state !== "idle" || !this.#converter) {
      return;
    }
    const photos = this.#remaining;
    const total = photos.length;
    const factor = this.#factor;
    const sharpenLevel = SHARPEN_LEVELS.find((l) => l.id === this.#sharpen) ?? SHARPEN_LEVELS[0];
    this.#state = "processing";
    this.#panel.focus({ preventScroll: true }); // controls swap away; park focus on the panel
    this.#announce?.(HD_COPY.announceStart(total));

    let saved = 0;
    let failed = 0;
    let clamped = 0;
    // v0.3.0 (user request: parallel conversion, ≥25 in a batch): ALL jobs
    // are handed to the converter POOL at once — HD_POOL_SIZE workers pull
    // from it in parallel, the UI thread stays free, and the progress bar
    // counts completions (the v0.2 loop was strictly one-at-a-time).
    //
    // Downloads are the ONE serialized step: the browser throttles/drops
    // anchor clicks that fire simultaneously (25 parallel clicks delivered
    // ~10 events). Completed conversions queue their downloads on this
    // chain and leave DOWNLOAD_SPACING_MS apart — parallel decode, paced
    // saves (the v0.2.1 probe-downloads evidence).
    let downloadChain = Promise.resolve();
    const queueDownload = (blob, name) => {
      downloadChain = downloadChain.then(async () => {
        triggerAnchorBlobDownload(blob, name);
        await sleep(DOWNLOAD_SPACING_MS);
      });
    };
    this.#renderProcessing(1, total, photos[0]?.name ?? "");
    const jobs = photos.map((photo, index) =>
      (async () => {
        // v0.3.0 batch optimization (the 25-photo budget): convert
        // OPTIMISTICALLY at the chosen factor — the machinery already
        // fails cleanly when the browser cannot allocate the canvas — and
        // run the §11.3.3 capability probe ONLY after such a failure, then
        // retry at the probed max. This removes 25 serialized main-thread
        // probes from the happy path (they were the 120s bottleneck).
        let result;
        try {
          result = await this.#converter.convert(photo, factor, {
            sharpen: sharpenLevel.amount,
            format: this.#format,
          });
        } catch {
          const supported = await this.#converter.probeMax(photo);
          const effective = Math.min(factor, supported);
          if (effective < factor) {
            clamped += 1;
          }
          result = await this.#converter.convert(photo, effective, {
            sharpen: sharpenLevel.amount,
            format: this.#format,
          });
        }
        queueDownload(result.blob, result.name);
        saved += 1;
      })()
        .then(() => {
          // 1-based completed count in the label; the fill carries the
          // completed fraction (analysis pattern).
          this.#renderProcessing(Math.min(saved + 1, total), total, `Completed ${saved} of ${total}`);
        })
        .catch(() => {
          failed += 1;
        }),
    );
    await Promise.all(jobs);
    await downloadChain; // every queued anchor click has fired (paced)

    this.#remaining = [];
    this.#state = "done";
    if (failed > 0) {
      // v0.3.0: with the pool, per-photo failures no longer abort the batch
      // — the done state discloses exactly what happened.
      this.#renderPartialDone(saved, failed, clamped);
      this.#announce?.(HD_COPY.announcePartial(saved, total));
    } else {
      this.#renderDone(saved, clamped);
      this.#announce?.(HD_COPY.announceDone(saved));
    }
  }

  /* ------------------------------------------------------------------
     Focus containment (APG dialog pattern, as in PhotoDetailView)
     ------------------------------------------------------------------ */

  #onPanelKeydown(event) {
    if (event.key === "Escape") {
      // §11.3.4: Escape = cancel while idle/failed; a running conversion is
      // not interrupted by Escape; the done state closes like its button.
      if (this.#state === "idle" || this.#state === "failed" || this.#state === "done") {
        event.preventDefault();
        this.close();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = [
      ...this.#panel.querySelectorAll("button:not([disabled]), input:not([disabled])"),
    ];
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.#panel.getRootNode().activeElement;
    if (!focusables.includes(active)) {
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
}

/* --------------------------------------------------------------------------
   Shared converter slider (module-private build, exported for the detail
   panel in ResultsView — both converter surfaces use the identical native
   range so the control language cannot drift)
   -------------------------------------------------------------------------- */

/** The §11.3.2 slider row: "Size [range] 2×" — native range, 44px hit row,
 *  aria-label + aria-valuetext, accent hard-stop fill (§10.4 reading). */
export function buildHDSliderRow({ value, max = MAX_UPSCALE_FACTOR, onInput, register }) {
  const row = document.createElement("div");
  row.className = "hd-slider";

  const label = document.createElement("span");
  label.className = "hd-slider__label";
  label.textContent = "Size";
  row.appendChild(label);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "hd-slider__input";
  input.min = "1";
  input.max = String(max);
  input.step = "0.5";
  input.value = String(value);
  input.setAttribute("aria-label", "Upscale factor");
  input.setAttribute("aria-valuetext", FACTOR_LABEL(value));
  const updateFill = () => {
    const min = Number.parseFloat(input.min);
    const maxValue = Number.parseFloat(input.max);
    const factor = Number.parseFloat(input.value);
    const pct = ((factor - min) / (maxValue - min)) * 100;
    input.style.setProperty("--hd-fill", `${pct}%`);
  };
  updateFill();
  input.addEventListener("input", () => {
    const factor = Number.parseFloat(input.value);
    input.setAttribute("aria-valuetext", FACTOR_LABEL(factor));
    updateFill();
    onInput?.(factor);
  });
  row.appendChild(input);
  register?.(input);

  const readout = document.createElement("span");
  readout.className = "hd-slider__value";
  readout.textContent = FACTOR_LABEL(value);
  input.addEventListener("input", () => {
    readout.textContent = FACTOR_LABEL(Number.parseFloat(input.value));
  });
  row.appendChild(readout);

  return row;
}
