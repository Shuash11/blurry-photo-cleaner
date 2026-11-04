/**
 * ReviewControls — the §9c/§8.1 bottom action bar of the results screen.
 *
 * Responsibilities:
 *   - selection summary ("3 selected · 24 total", tabular figures)
 *   - "Add more" (secondary; re-enters intake for newly added files only)
 *   - "Download selected" (primary; sequential anchor downloads of the
 *     original File objects — Decision Record route A, no zip library)
 *   - the §13 device-reality line: the app cannot delete from the phone
 *   - busy state during downloads: primary label "Preparing…" with the one
 *     permitted inline spinner; "Add more" disabled while it runs
 *
 * Selection state itself lives in ResultsView; this bar only displays the
 * count (App pushes updates) and asks the provider for the selected files.
 */

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

/**
 * Save one File via a temporary download anchor. Shared with ResultsView
 * (per-item download in the detail view) so there is exactly one download
 * mechanism in the app.
 */
export function triggerAnchorDownload(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name; // original filename is preserved (plan route A)
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download has started; revoke after use — bounded delay, no leak.
  setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}

export class ReviewControls {
  #host = null;          // element the bar is mounted into
  #bar = null;
  #summaryEl = null;
  #addMoreBtn = null;
  #downloadBtn = null;
  #downloadLabel = null;
  #spinner = null;
  #selected = 0;
  #total = 0;
  #busy = false;
  #selectionSynced = false; // F8: false until the first setSummary — the initial render never announces
  #selectionAnnounceTimer = null;
  #getSelectedFiles;
  #onAddMore;
  #announce;

  constructor({ getSelectedFiles, onAddMore, announce }) {
    this.#getSelectedFiles = getSelectedFiles;
    this.#onAddMore = onAddMore;
    this.#announce = announce;
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
    this.#downloadBtn = null;
    this.#downloadLabel = null;
    this.#spinner = null;
    this.#busy = false;
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
}
