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

import { MAX_UPSCALE_FACTOR } from "./Thresholds.js";

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
  #onDeleteSelected;
  #announce;
  #externalLockChange; // App-provided: tiles go inert while a batch conversion runs (§11.3.4)

  constructor({ getSelectedFiles, getSelectedPhotos, getConverter, onAddMore, onDeleteSelected, announce, onLockChange }) {
    this.#getSelectedFiles = getSelectedFiles;
    this.#getSelectedPhotos = getSelectedPhotos;
    this.#getConverter = getConverter;
    this.#onAddMore = onAddMore;
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
    this.#refresh();
  }

  unmount() {
    this.#bar?.remove();
    this.#bar = null;
    this.#summaryEl = null;
    this.#addMoreBtn = null;
    this.#hdBtn = null;
    this.#deleteBtn = null;
    this.#downloadBtn = null;
    this.#downloadLabel = null;
    this.#spinner = null;
    this.#busy = false;
    this.#hdDialog?.close();
    this.#hdDialog = null;
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
  }

  /**
   * Sequential anchor downloads of the selected files' original File
   * objects (route A). Zero-selected is blocked: the button is disabled
   * (§8.1) and this guard is defense in depth.
   */
  async #downloadSelected() {
    if (this.#busy) {
      return;
    }
    const files = this.#getSelectedFiles?.() ?? [];
    if (files.length === 0) {
      return;
    }

    this.#busy = true;
    this.#refresh();
    if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
      this.#downloadLabel.textContent = "Preparing…";
      this.#spinner.hidden = false;
    }
    // §12: download status through the polite live region.
    this.#announce?.(
      `Preparing ${files.length} ${files.length === 1 ? "photo" : "photos"}`,
    );

    for (const file of files) {
      triggerAnchorDownload(file);
      await sleep(DOWNLOAD_SPACING_MS);
    }

    this.#busy = false;
    if (this.#downloadBtn && this.#downloadLabel && this.#spinner) {
      this.#downloadLabel.textContent = "Download selected";
      this.#spinner.hidden = true;
    }
    this.#refresh();
    this.#announce?.(
      `Saved ${files.length} ${files.length === 1 ? "photo" : "photos"}`,
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

const HD_COPY = {
  heading: "Save HD copies",
  honesty: "Upscaled — enlarged, same captured detail.",
  scope: "Saved as a download. It never re-enters the review — scores and bands stay with your originals.",
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
    const body = this.#body;
    body.replaceChildren();

    const message = document.createElement("p");
    message.className = "hd-dialog__lede";
    message.textContent = HD_COPY.done(savedCount);
    body.appendChild(message);

    if (clampedCount > 0) {
      const clamped = document.createElement("p");
      clamped.className = "hd-copy";
      clamped.textContent = HD_COPY.clamped(clampedCount);
      body.appendChild(clamped);
    }

    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn-primary hd-dialog__apply";
    done.textContent = "Done";
    done.addEventListener("click", () => this.close());
    body.appendChild(done);
    // §11.6.2: Done state → the "Done" button.
    done.focus();
  }

  #renderFailed(savedCount, total) {
    const body = this.#body;
    body.replaceChildren();

    const message = document.createElement("p");
    message.className = "hd-dialog__lede";
    message.textContent = savedCount > 0 ? HD_COPY.partial(savedCount, total) : HD_COPY.failedAll;
    body.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "hd-dialog__actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    actions.appendChild(cancel);

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn-primary";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      // Re-queue only the unsaved (§11.3.4); already-saved files stay saved
      // and #remaining was cut down to them when the run failed.
      this.#state = "idle";
      this.#run();
    });
    actions.appendChild(retry);
    body.appendChild(actions);

    // The least destructive action takes focus on a failed state (APG).
    cancel.focus();
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
    this.#state = "processing";
    this.#panel.focus({ preventScroll: true }); // controls swap away; park focus on the panel
    this.#announce?.(HD_COPY.announceStart(total));

    let saved = 0;
    let clamped = 0;
    try {
      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        // 1-based current item in the label ("Upscaling 3 of 12" — §11.3.4),
        // bar fill carries the completed fraction (analysis pattern).
        this.#renderProcessing(Math.min(saved + 1, total), total, photo.name);
        // §11.3.3: the probe runs per photo at convert time; a photo that
        // cannot reach the chosen factor saves at its own supported max —
        // never silently (the done state discloses the count).
        const supported = await this.#converter.probeMax(photo);
        const effective = Math.min(factor, supported);
        if (effective < factor) {
          clamped += 1;
        }
        const result = await this.#converter.convert(photo, effective);
        triggerAnchorBlobDownload(result.blob, result.name);
        saved += 1;
        // Sequential spacing between consecutive anchor clicks — the
        // DOWNLOAD_SPACING_MS evidence (:17, probe-downloads.js): a batch of
        // fast-converting photos must not fire downloads closer together
        // than the browser reliably honors. The last download needs no
        // trailing wait — the done state may show immediately.
        if (i < photos.length - 1) {
          await sleep(DOWNLOAD_SPACING_MS);
        }
      }
    } catch {
      // §11.3.4 failure partway: stop, report what saved, offer Try again
      // over the unsaved remainder (already-saved files stay saved).
      this.#remaining = photos.slice(saved);
      this.#state = "failed";
      this.#renderFailed(saved, total);
      this.#announce?.(HD_COPY.announcePartial(saved, total));
      return;
    }

    this.#remaining = [];
    this.#state = "done";
    this.#renderDone(saved, clamped);
    this.#announce?.(HD_COPY.announceDone(saved));
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
