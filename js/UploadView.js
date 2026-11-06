/**
 * UploadView — owns the upload/thumbnail DOM (design spec §8.2, §9a, §9b, §9e).
 *
 * Responsibilities:
 *   - empty/upload state and its all-failed variant
 *   - the whole-content-area drop zone and its drag feedback
 *   - file input + progressive-enhancement folder pick (§11 — feature detected;
 *     the control is absent from the DOM entirely when unsupported)
 *   - gallery toolbar, pending grid (placeholder → resolved tile), notices
 *   - the §9b analysis progress card and its polite live announcements
 *   - the polite live region used for outcome announcements (§12)
 *
 * The view never decides what a file is — it reports chosen files to App via
 * callbacks and renders the PhotoStore records it is given. Notice *policy*
 * (when the §9e notice is visible) belongs to App; the view renders it.
 * Phase 4: once analysis completes, App hands the view root to ResultsView;
 * notices follow via setNoticeHost() so §9e cards stay visible in every state.
 */

import { BAND_SKIPPED, MAX_BATCH_FILES, MAX_FILE_LABEL, formatPercent } from "./Thresholds.js";

const MAX_LISTED_FILENAMES = 50; // display cap only — the count is always the true total
// UX F6: "Analyzing N of M" is throttled to at most one polite announcement
// per PROGRESS_ANNOUNCE_MIN_MS — a per-photo cadence queued one live-region
// update per photo (100-photo batch = 100 announcements), which MDN's
// live-region guidance rejects as "so rapid as to be annoying". A time floor
// bounds the rate for any batch size (a %-of-total step would still fire
// per-photo on small batches); the visible §9b status line always updates
// per photo, and the final "Analysis complete: …" outcome always announces
// (App, §12). The first state of each analysis always announces.
const PROGRESS_ANNOUNCE_MIN_MS = 500;
const SVG_NS = "http://www.w3.org/2000/svg";

export class UploadView {
  #contentEl;
  #viewRoot;
  #liveRegion;
  #fileInput;
  #callbacks;
  #webkitInput = null;    // lazily created webkitdirectory input (feature-detected use)
  #mode = "empty";        // "empty" | "gallery"
  #toolbarEl = null;
  #addMoreBtn = null;
  #gridEl = null;
  #countEl = null;
  #noticeEl = null;
  #noticeHost = null;     // set while ResultsView owns the root (results mode)
  #progressCard = null;   // §9b analysis progress card, when analyzing
  #progressStatus = null;
  #progressFill = null;
  #lastProgressKey = "";
  #lastProgressAnnounceMs = 0; // F6: Date.now() of the last progress announcement
  #nextPlaceholderId = 1;

  constructor({ contentEl, viewRoot, liveRegion, fileInput, callbacks }) {
    this.#contentEl = contentEl;
    this.#viewRoot = viewRoot;
    this.#liveRegion = liveRegion;
    this.#fileInput = fileInput;
    this.#callbacks = callbacks;

    this.#bindFileInput();
    this.#bindDropZone();
  }

  /* ------------------------------------------------------------------
     Rendering entry points (called by App)
     ------------------------------------------------------------------ */

  /**
   * §9a empty state. Variants: "all-failed" and "all-failed-oversize" (INF-1)
   * are the §9e no-results compositions — the latter when size was the only
   * reason anything failed, so the copy names the limit instead of decode.
   */
  renderEmpty(variant = "default") {
    this.#mode = "empty";
    this.#toolbarEl = null;
    this.#addMoreBtn = null;
    this.#gridEl = null;
    this.#countEl = null;
    this.#noticeEl?.remove(); // may live in the results notice slot — remove for real
    this.#noticeEl = null;
    this.#noticeHost = null;
    this.#progressCard = null;
    this.#lastProgressKey = "";
    this.#viewRoot.replaceChildren(this.#buildEmptyState(variant));
  }

  /**
   * Begin a batch of incoming files: switch to (or rebuild) the pending-grid
   * state and append one placeholder tile per file — filename and size are
   * known at once; the thumbnail area shows the spec's muted placeholder
   * block (§8.1). The toolbar count shows the optimistic total until the
   * batch resolves. items: [{ id, name, size }]
   *
   * existingPhotos (Phase 4): store records already in the gallery. When a
   * batch starts while results are shown ("Add more"), the view root has
   * been handed to ResultsView, so the pending grid is rebuilt with the
   * existing scored tiles first — existing scores persist (spec §10).
   */
  beginBatch(items, expectedTotal, existingPhotos = []) {
    // Rebuild the shell when it is missing OR detached: after ResultsView
    // took the view root (results mode), the old toolbar/grid references are
    // still set but no longer connected, so appending to them would render
    // nothing visible (§10: "Add more" re-enters the pending grid).
    if (!this.#gridEl || this.#gridEl.isConnected === false) {
      this.#buildGalleryShell();
    }
    this.#mode = "gallery";
    for (const record of existingPhotos) {
      this.#gridEl.appendChild(this.#buildTile(record, { pending: false }));
    }
    for (const item of items) {
      this.#gridEl.appendChild(this.#buildTile(item, { pending: true }));
    }
    if (this.#countEl) {
      this.#countEl.textContent = `${expectedTotal} ${expectedTotal === 1 ? "photo" : "photos"}`;
    }
    if (this.#noticeEl && this.#noticeEl.isConnected === false) {
      this.#mountNoticeEl(); // notice survived the results → pending switch (§10)
    }
  }

  /** Swap a placeholder tile for its decoded thumbnail record. */
  resolveTile(placeholderId, record) {
    const placeholder = this.#gridEl?.querySelector(`[data-id="${placeholderId}"]`);
    if (!placeholder) return;
    placeholder.replaceWith(this.#buildTile(record, { pending: false }));
  }

  /** Remove a placeholder tile whose file could not be opened. */
  failTile(placeholderId) {
    this.#gridEl?.querySelector(`[data-id="${placeholderId}"]`)?.remove();
  }

  /**
   * Phase 3/4: fill a tile's score chip once its analysis result lands —
   * "NN% sharp" (§11.2, via the shared formatPercent helper) plus the
   * band-colored dot. The chip stays "—" for photos skipped by analysis
   * (the analysis-skip notice carries that message; a skip has no score,
   * never "0% sharp"); the results grid restyles every chip at render time.
   */
  setTileScore(recordId, score, band = null) {
    const tile = this.#gridEl?.querySelector(`[data-id="${CSS.escape(String(recordId))}"]`);
    if (!tile) {
      return;
    }
    const chip = tile.querySelector(".chip");
    const num = tile.querySelector(".chip__num");
    if (num) {
      num.textContent = formatPercent(score);
    }
    if (chip) {
      chip.classList.remove("chip--pending");
      if (band) {
        chip.classList.add(`chip--${band}`);
      }
    }
  }

  /* ------------------------------------------------------------------
     Phase 4 — §9b analysis progress card (the duck-typed App seam)
     ------------------------------------------------------------------ */

  /**
   * Receives every analysisState transition. While analyzing: the progress
   * card sits above the pending grid (§9b), the bar fills via scaleX, the
   * status line shows "7 of 24", and the polite live region announces
   * "Analyzing 7 of 24" (§12) — rate-limited to one per
   * PROGRESS_ANNOUNCE_MIN_MS (UX F6). Any other phase removes the card —
   * App then either hands the root to ResultsView or shows the §9e error
   * notice.
   */
  onAnalysisProgress(state) {
    if (state.phase === "analyzing") {
      this.#showProgressCard(state);
      if (this.#addMoreBtn) {
        this.#addMoreBtn.hidden = true; // §9b: no intake affordance mid-analysis
      }
      return;
    }
    this.#removeProgressCard();
    if (this.#addMoreBtn) {
      this.#addMoreBtn.hidden = false;
    }
  }

  #showProgressCard(state) {
    if (!this.#progressCard) {
      this.#progressCard = this.#buildProgressCard();
      const reference = this.#toolbarEl ?? this.#viewRoot.firstChild;
      this.#viewRoot.insertBefore(this.#progressCard, reference);
    }
    const { done, total } = state;
    if (this.#progressStatus) {
      this.#progressStatus.textContent = `${done} of ${total}`;
    }
    if (this.#progressFill) {
      const fraction = total > 0 ? done / total : 0;
      this.#progressFill.style.transform = `scaleX(${fraction})`;
    }
    const bar = this.#progressCard.querySelector(".progress-card__bar");
    if (bar) {
      bar.setAttribute("aria-valuenow", String(done));
      bar.setAttribute("aria-valuemax", String(total));
    }
    // UX F6: the live-region announcement is rate-limited (see
    // PROGRESS_ANNOUNCE_MIN_MS); the visible status text above always
    // updates. `now - 0` passes on the first state, so every analysis
    // announces at least once; later increments inside the window are
    // dropped (the completion message, which always announces, carries the
    // final outcome).
    const key = `Analyzing ${done} of ${total}`;
    const now = Date.now();
    if (
      key !== this.#lastProgressKey &&
      now - this.#lastProgressAnnounceMs >= PROGRESS_ANNOUNCE_MIN_MS
    ) {
      this.#lastProgressKey = key;
      this.#lastProgressAnnounceMs = now;
      this.announce(key);
    }
  }

  #removeProgressCard() {
    this.#progressCard?.remove();
    this.#progressCard = null;
    this.#progressStatus = null;
    this.#progressFill = null;
    this.#lastProgressKey = "";
    this.#lastProgressAnnounceMs = 0; // fresh cadence for the next analysis
  }

  /**
   * §8.2 analysis progress card: surface card, hairline, radius-lg, 16px
   * padding, max-width 560px; heading, tabular status line, 4px determinate
   * bar (track --color-track, accent fill moved with scaleX — never width).
   */
  #buildProgressCard() {
    const card = document.createElement("section");
    card.className = "progress-card";

    const heading = document.createElement("h2");
    heading.className = "progress-card__heading";
    heading.textContent = "Analyzing photos";
    card.appendChild(heading);

    const status = document.createElement("p");
    status.className = "progress-card__status";
    status.textContent = "0 of 0";
    card.appendChild(status);
    this.#progressStatus = status;

    const bar = document.createElement("div");
    bar.className = "progress-card__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Analyzing photos");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "0");
    bar.setAttribute("aria-valuenow", "0");

    const fill = document.createElement("div");
    fill.className = "progress-card__fill";
    bar.appendChild(fill);
    card.appendChild(bar);
    this.#progressFill = fill;

    return card;
  }

  /**
   * Batch finished: refresh the count and announce the outcome. The
   * undecodable-files notice is NOT shown here — App owns the skip ledger
   * (§10: names accumulate across batches until dismissed) and calls
   * showUndecodableNotice() when the notice must be visible.
   */
  finishBatch({ totalPhotos, addedCount }) {
    if (this.#countEl) {
      this.#countEl.textContent = `${totalPhotos} ${totalPhotos === 1 ? "photo" : "photos"}`;
    }

    if (addedCount > 0) {
      // The notice (role="status") announces the skipped files itself when
      // present, so the live region only adds the accepted-photos part.
      this.announce(`Added ${addedCount} ${addedCount === 1 ? "photo" : "photos"}.`);
    }
  }

  /**
   * Undecodable-files notice (§9e). App decides when this must be visible
   * (skip ledger, dismissed state); the view only renders it.
   */
  showUndecodableNotice(names) {
    this.#showNotice(
      this.#buildFileListNotice({
        heading: `${names.length} ${names.length === 1 ? "file" : "files"} couldn't be opened`,
        body: "Your browser can't decode these formats. They were skipped — nothing was changed.",
        names,
        noun: "file",
        helperText: names.some((name) => /\.heic$|\.hif$/i.test(name))
          ? "iPhone HEIC photos may need converting to JPEG first."
          : null,
        dismissKind: "undecodable",
      }),
    );
  }

  /**
   * Analysis-skip notice (Phase 3): photos that decoded fine but have no
   * visible pixels to score. Same card pattern as §9e; App owns the ledger.
   */
  showAnalysisSkippedNotice(names) {
    this.#showNotice(
      this.#buildFileListNotice({
        heading: `${names.length} ${names.length === 1 ? "photo" : "photos"} couldn't be analyzed`,
        body: "These photos have no visible pixels, so they can't be scored. They were skipped — nothing was changed.",
        names,
        noun: "photo",
        dismissKind: "analysis-skip",
      }),
    );
  }

  /**
   * Oversize-files notice (INF-1): files rejected at intake because they
   * are over the per-file size cap. Same card pattern as §9e — counted,
   * named in the disclosure list, honest about the reason. App owns the
   * ledger; the limit in the copy derives from MAX_FILE_LABEL so it can
   * never drift from the enforced constant.
   */
  showOversizeNotice(names) {
    this.#showNotice(
      this.#buildFileListNotice({
        heading: `${names.length} ${names.length === 1 ? "file" : "files"} ${names.length === 1 ? "was" : "were"} too large — over ${MAX_FILE_LABEL}`,
        body: `Photos over ${MAX_FILE_LABEL} can't be loaded. They were skipped — nothing was changed.`,
        names,
        noun: "file",
        dismissKind: "oversize",
      }),
    );
  }

  /**
   * Over-count notice (INF-1): files beyond the per-batch limit were not
   * added. Same card pattern as §9e; App owns the ledger.
   */
  showOverCountNotice(names) {
    this.#showNotice(
      this.#buildFileListNotice({
        heading: `${names.length} ${names.length === 1 ? "file" : "files"} ${names.length === 1 ? "wasn't" : "weren't"} added`,
        body: `Only the first ${MAX_BATCH_FILES} files can be loaded at once. The rest were skipped — nothing was changed.`,
        names,
        noun: "file",
        dismissKind: "over-count",
      }),
    );
  }

  /** Generic-error notice (§8.2 "Something went wrong" variant). */
  showError({ body, onRetry }) {
    this.#showNotice(this.#buildErrorNotice(body, onRetry));
    this.announce(body);
  }

  announce(text) {
    this.#liveRegion.textContent = text;
  }

  /** Open the shared file picker (Phase 4: the results "Add more" uses it). */
  openFilePicker() {
    this.#fileInput.click();
  }

  /**
   * Phase 4 notice routing (§10): while ResultsView owns the view root, App
   * points the notice host at the results notice slot so §9e cards stay
   * first in the content flow in every state. Passing null re-mounts any
   * visible notice back into this view's root.
   */
  setNoticeHost(hostEl) {
    this.#noticeHost = hostEl ?? null;
    if (this.#noticeEl) {
      this.#mountNoticeEl();
    }
  }

  nextPlaceholderId() {
    return `ph${this.#nextPlaceholderId++}`;
  }

  /* ------------------------------------------------------------------
     Event wiring
     ------------------------------------------------------------------ */

  #bindFileInput() {
    this.#fileInput.addEventListener("change", () => {
      const files = Array.from(this.#fileInput.files ?? []);
      this.#fileInput.value = ""; // allow re-selecting the same file
      if (files.length > 0) {
        this.#callbacks.onFilesChosen(files);
      }
    });
  }

  #bindDropZone() {
    const zone = this.#contentEl;
    let dragDepth = 0;

    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      zone.classList.add("is-dragover");
    });

    zone.addEventListener("dragover", (event) => {
      event.preventDefault(); // required for drop to fire
    });

    zone.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        zone.classList.remove("is-dragover");
      }
    });

    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      zone.classList.remove("is-dragover");
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        this.#callbacks.onFilesChosen(files);
      }
    });

    // Keep the browser from navigating away when a file is released
    // outside the content area.
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => event.preventDefault());
  }

  /* ------------------------------------------------------------------
     Folder pick — progressive enhancement only (§11). Priority 1:
     showDirectoryPicker() in a secure context. Priority 2: webkitdirectory,
     itself feature-detected. Otherwise no control exists in the DOM.
     ------------------------------------------------------------------ */

  #detectFolderPick() {
    if (window.isSecureContext && typeof window.showDirectoryPicker === "function") {
      return "fs-access";
    }
    // §11 verbatim: the webkitdirectory fallback must itself be feature-
    // detected against the input element prototype.
    if ("webkitdirectory" in HTMLInputElement.prototype) {
      return "webkit";
    }
    return null;
  }

  #buildFolderButton(folderPickMode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.appendChild(this.#icon("folder"));
    button.appendChild(document.createTextNode("Choose folder"));
    button.addEventListener("click", () => {
      if (folderPickMode === "fs-access") {
        this.#pickDirectory();
      } else {
        this.#pickWebkitDirectory();
      }
    });
    return button;
  }

  async #pickDirectory() {
    try {
      const directory = await window.showDirectoryPicker();
      const entries = await collectDirectoryFiles(directory);
      const items = entries.map((entry) => entry.file ?? { name: entry.name, unreadable: true });
      this.#callbacks.onFilesChosen(items);
    } catch (error) {
      if (error && error.name === "AbortError") {
        return; // user cancelled the picker — not a failure
      }
      this.showError({
        body: "The folder couldn't be opened. Nothing was changed.",
        onRetry: () => this.#pickDirectory(),
      });
    }
  }

  #pickWebkitDirectory() {
    // One persistent hidden input, reused across picks (a detached input can
    // have its chooser cancelled). It lives outside the rendered view flow.
    if (!this.#webkitInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.setAttribute("webkitdirectory", "");
      input.classList.add("hidden-input");
      input.setAttribute("tabindex", "-1");
      input.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => {
        const files = Array.from(input.files ?? []);
        if (files.length > 0) {
          this.#callbacks.onFilesChosen(files);
        }
      });
      this.#webkitInput = input;
    }
    document.body.appendChild(this.#webkitInput);
    this.#webkitInput.click();
  }

  /* ------------------------------------------------------------------
     Builders
     ------------------------------------------------------------------ */

  #buildEmptyState(variant) {
    const failed = variant === "all-failed" || variant === "all-failed-oversize";
    const oversizeOnly = variant === "all-failed-oversize";
    // Re-detected per render: the folder-pick control exists only while the
    // context actually supports it (§11 — absent, never disabled-looking).
    const folderPickMode = this.#detectFolderPick();
    const section = document.createElement("section");
    section.className = failed ? "empty-state empty-state--failed" : "empty-state";

    const icon = document.createElement("span");
    icon.className = "empty-state__icon";
    icon.appendChild(this.#icon(failed ? "warning" : "photo"));
    section.appendChild(icon);

    const title = document.createElement("h2");
    title.className = "empty-state__title";
    title.textContent = oversizeOnly
      ? "Those files were too large"
      : failed
        ? "Couldn't open those files"
        : "Find the blurry photos";
    section.appendChild(title);

    const body = document.createElement("p");
    body.className = "empty-state__body";
    body.textContent = oversizeOnly
      ? `Try smaller photos — files over ${MAX_FILE_LABEL} can't be loaded. Nothing was changed.`
      : failed
        ? "Try JPEG or PNG photos — this browser couldn't decode them. Nothing was changed."
        : "Choose photos from your library — they stay on this device.";
    section.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "empty-state__actions";

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "btn-primary btn-hero";
    choose.textContent = "Choose photos";
    choose.addEventListener("click", () => this.#fileInput.click());
    actions.appendChild(choose);

    if (folderPickMode !== null) {
      actions.appendChild(this.#buildFolderButton(folderPickMode));
    }

    section.appendChild(actions);

    const hint = document.createElement("p");
    hint.className = "empty-state__drop-hint";
    hint.textContent = "or drop photos here";
    section.appendChild(hint);

    const privacy = document.createElement("p");
    privacy.className = "empty-state__privacy";
    privacy.textContent = "Photos never leave this device.";
    section.appendChild(privacy);

    return section;
  }

  #buildGalleryShell() {
    const toolbar = document.createElement("div");
    toolbar.className = "gallery-toolbar";

    const label = document.createElement("h2");
    label.className = "gallery-toolbar__label";
    label.textContent = "Photos";
    toolbar.appendChild(label);

    this.#countEl = document.createElement("span");
    this.#countEl.className = "gallery-toolbar__count";
    this.#countEl.textContent = "0 photos";
    label.appendChild(this.#countEl);

    const addMore = document.createElement("button");
    addMore.type = "button";
    addMore.className = "btn-text btn-text--compact"; // 32px fine-pointer density (design-spec-v2 §5)
    addMore.textContent = "Add more";
    addMore.addEventListener("click", () => this.openFilePicker());
    toolbar.appendChild(addMore);
    this.#addMoreBtn = addMore;

    this.#toolbarEl = toolbar;

    this.#gridEl = document.createElement("ul");
    this.#gridEl.className = "photo-grid";

    this.#viewRoot.replaceChildren(toolbar, this.#gridEl);
  }

  #buildTile(item, { pending }) {
    const tile = document.createElement("li");
    tile.className = "tile";
    tile.dataset.id = item.id;

    const photo = document.createElement("div");
    photo.className = "tile__photo";
    if (!pending) {
      const img = document.createElement("img");
      img.src = item.thumbURL;
      img.alt = ""; // the filename below is the accessible name
      img.width = item.width;
      img.height = item.height;
      img.loading = "lazy";
      photo.appendChild(img);
    }
    tile.appendChild(photo);

    const filename = document.createElement("p");
    filename.className = "tile__filename";
    filename.textContent = item.name;
    filename.title = item.name; // full name recoverable; grid truncates (§4.3)
    tile.appendChild(filename);

    const meta = document.createElement("div");
    meta.className = "tile__meta";

    const chip = document.createElement("span");
    chip.className = "chip";
    const dot = document.createElement("span");
    dot.className = "chip__dot";
    const score = document.createElement("span");
    score.className = "chip__num";
    // Scored records (e.g. re-rendered existing tiles on "Add more") show
    // "NN% sharp" with band colors right away (§11.2, shared helper);
    // everything else is the pending "—" state (§8.1) until analysis fills
    // it in.
    if (!pending && typeof item.score === "number" && item.band && item.band !== BAND_SKIPPED) {
      chip.classList.add(`chip--${item.band}`);
      score.textContent = formatPercent(item.score);
    } else {
      chip.classList.add("chip--pending");
      score.textContent = "—";
    }
    chip.append(dot, score);
    meta.appendChild(chip);

    // §11.2 layout consequence: the percentage chip is ≈3× wider than the
    // bare score, so the file-size caption yields its tile slot here too —
    // every tile carries the same row structure (filename, chip), and the
    // size surfaces in the detail view per §11.2/§11.5.

    tile.appendChild(meta);
    return tile;
  }

  /* ------------------------------------------------------------------
     Notices (§8.2, §9e)
     ------------------------------------------------------------------ */

  #showNotice(noticeEl) {
    this.#noticeEl?.remove();
    this.#noticeEl = noticeEl;
    this.#mountNoticeEl();
  }

  /** Insert the active notice as the first element of the current host. */
  #mountNoticeEl() {
    const host = this.#noticeHost ?? this.#viewRoot;
    this.#noticeEl.remove();
    host.insertBefore(this.#noticeEl, host.firstChild);
  }

  #buildNoticeShell(iconName) {
    const notice = document.createElement("section");
    notice.className = "notice";
    notice.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "notice__icon";
    icon.appendChild(this.#icon(iconName));
    notice.appendChild(icon);

    const content = document.createElement("div");
    content.className = "notice__content";
    notice.appendChild(content);

    return { notice, content };
  }

  /**
   * Shared notice card (§8.2/§9e pattern): heading, body, expandable file
   * list, optional helper line, and a Dismiss button that reports which
   * ledger to clear via callbacks.onNoticeDismissed(kind).
   * options: { heading, body, names, noun, helperText?, dismissKind }
   */
  #buildFileListNotice({ heading, body, names, noun, helperText = null, dismissKind }) {
    const { notice, content } = this.#buildNoticeShell("warning");

    const headingEl = document.createElement("h2");
    headingEl.className = "notice__heading";
    headingEl.textContent = heading;
    content.appendChild(headingEl);

    const bodyP = document.createElement("p");
    bodyP.className = "notice__body";
    bodyP.textContent = body;
    content.appendChild(bodyP);

    const details = document.createElement("details");
    details.className = "notice__details";

    const summary = document.createElement("summary");
    // Joins the .btn-text component (design-spec-v2 §5): the component
    // supplies type, accent color, and target size; .notice__summary keeps
    // only its <summary>-specific layout rules in the stylesheet.
    summary.className = "notice__summary btn-text btn-text--compact";
    summary.textContent = `See the ${names.length} ${names.length === 1 ? noun : `${noun}s`}`;
    details.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "notice__filelist";
    const shown = names.slice(0, MAX_LISTED_FILENAMES);
    for (const name of shown) {
      const li = document.createElement("li");
      li.textContent = name;
      list.appendChild(li);
    }
    if (names.length > shown.length) {
      const more = document.createElement("li");
      more.textContent = `…and ${names.length - shown.length} more`;
      list.appendChild(more);
    }
    details.appendChild(list);
    content.appendChild(details);

    if (helperText) {
      const helper = document.createElement("p");
      helper.className = "notice__helper";
      helper.textContent = helperText;
      content.appendChild(helper);
    }

    const footer = document.createElement("div");
    footer.className = "notice__footer";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn-text";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      this.#noticeEl?.remove();
      this.#noticeEl = null;
      this.#callbacks.onNoticeDismissed?.(dismissKind); // App clears that ledger (§10)
    });
    footer.appendChild(dismiss);
    content.appendChild(footer);

    return notice;
  }

  #buildErrorNotice(body, onRetry) {
    const { notice, content } = this.#buildNoticeShell("warning");

    const heading = document.createElement("h2");
    heading.className = "notice__heading";
    heading.textContent = "Something went wrong";
    content.appendChild(heading);

    const bodyP = document.createElement("p");
    bodyP.className = "notice__body";
    bodyP.textContent = body;
    content.appendChild(bodyP);

    const footer = document.createElement("div");
    footer.className = "notice__footer";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn-primary";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      this.#noticeEl?.remove();
      this.#noticeEl = null;
      onRetry?.();
    });
    footer.appendChild(retry);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn-text";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      this.#noticeEl?.remove();
      this.#noticeEl = null;
    });
    footer.appendChild(dismiss);

    content.appendChild(footer);
    return notice;
  }

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

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

/**
 * Walk a picked directory recursively and collect every file entry.
 * Entries whose File cannot be read come back as { name } markers so the
 * pipeline can count them visibly instead of dropping them silently.
 */
async function collectDirectoryFiles(directoryHandle) {
  const entries = [];
  async function walk(handle) {
    for await (const entry of handle.values()) {
      if (entry.kind === "file") {
        try {
          entries.push({ name: entry.name, file: await entry.getFile() });
        } catch {
          entries.push({ name: entry.name, file: null });
        }
      } else if (entry.kind === "directory") {
        await walk(entry);
      }
    }
  }
  await walk(directoryHandle);
  return entries;
}
