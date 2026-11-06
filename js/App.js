/**
 * App — orchestrates application state and the file-intake pipeline.
 *
 * State flow (design spec §10): empty/upload → photos selected (pending
 * grid, §9b) → blur analysis runs over each added batch in a worker while
 * the §9b progress card fills → on completion the view root moves to the
 * grouped results (ResultsView + ReviewControls, §9c/§9d). "Add more" from
 * results re-enters the pending grid for the new files only; existing
 * scores persist.
 *
 *   picker / drop / folder pick → handleFilesChosen()
 *     → intake caps (INF-1): files over MAX_FILE_BYTES and items beyond
 *       MAX_BATCH_FILES are partitioned out before any decode and join
 *       their own skip ledgers (§9e-style notices, never silent)
 *     → placeholders appear immediately (instant feedback, §8.1 loading state)
 *     → PhotoStore.createRecord() decode-verifies each file for real
 *     → resolved records become thumbnails; failures become the §9e notice
 *     → BlurAnalyzer scores the batch in a Web Worker (never blocks the UI);
 *       zero-pixel photos join the analysis-skip ledger (§9e-style notice)
 *     → analysis complete → grouped results with the §6.2 band reveal
 *
 * Everything (batches, analysis, start-over) runs serialized on one queue,
 * so store mutation can never race a clear().
 */

import { BlurAnalyzer } from "./BlurAnalyzer.js";
import { HDConverter } from "./HDConverter.js";
import { ResultsView } from "./ResultsView.js";
import { ReviewControls } from "./ReviewControls.js";
import {
  BAND_BLURRY,
  BAND_REVIEW,
  BAND_SHARP,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
} from "./Thresholds.js";

const DECODE_CONCURRENCY = 4; // keeps big folder picks responsive without memory spikes

export class App {
  #store;
  #view;
  #startOverBtn;
  #analyzer;
  #hdConverter;
  #resultsView;
  #reviewControls;
  #fileInput;
  #headerTitle;
  // "empty" | "pending" | "results" — which surface owns the view root.
  #mode = "empty";
  #queue = Promise.resolve(); // batches run in the order the user chose them
  // Undecodable-file ledger (§10): names stay listed in the §9e notice in
  // every later state until the user dismisses it or starts over — never a
  // silent drop, and never lost when a later batch has no failures.
  #skippedNames = [];
  #noticeDismissed = false;
  // Analysis-skip ledger (Phase 3): same pattern, for photos that decoded
  // fine but have no visible pixels to score.
  #analysisSkippedNames = [];
  #analysisSkipDismissed = false;
  // Intake-cap ledgers (INF-1): same skip-ledger pattern, for files
  // rejected before decode — over the per-file size cap, or beyond the
  // per-batch count cap. Names accumulate across batches until dismissed
  // or start-over, exactly like #skippedNames.
  #oversizeNames = [];
  #oversizeDismissed = false;
  #overCountNames = [];
  #overCountDismissed = false;
  // Phase 3 analysis state, exposed for the Phase 4 analyzing UI (§9b):
  // { phase: "idle" | "analyzing" | "failed", done, total, currentName }
  #analysisState = { phase: "idle", done: 0, total: 0, currentName: null };

  constructor({ store, view, startOverBtn }) {
    this.#store = store;
    this.#view = view;
    this.#startOverBtn = startOverBtn;
    this.#analyzer = new BlurAnalyzer();
    this.#hdConverter = new HDConverter();

    // Same markup contract main.js already asserts (index.html); these are
    // the remaining Phase 4 mount points.
    this.#fileInput = document.getElementById("file-input");
    this.#headerTitle = document.querySelector(".app-title");

    this.#resultsView = new ResultsView({
      root: document.getElementById("view-root"),
      callbacks: {
        onSelectionChange: () => this.#syncSelectionCount(),
        // §11.3: the detail view consumes the converter for the capability
        // probe (entry gate) and the per-photo conversion.
        getConverter: () => this.#hdConverter,
        announce: (text) => this.#view.announce(text),
        // §11.5.4: the dialog confirmed — App performs the removal.
        onDeletePhotos: (ids) => this.#deletePhotos(ids),
      },
    });
    this.#reviewControls = new ReviewControls({
      getSelectedFiles: () =>
        this.#resultsView.getSelectedPhotos().map((photo) => photo.file),
      getSelectedPhotos: () => this.#resultsView.getSelectedPhotos(),
      getConverter: () => this.#hdConverter,
      onAddMore: () => this.#view.openFilePicker(),
      // §11.5.2: the action-bar trigger forwards to the shared dialog via
      // ResultsView (the single delete gate).
      onDeleteSelected: (trigger) =>
        this.#resultsView.requestDeleteSelected(trigger),
      announce: (text) => this.#view.announce(text),
      // §11.3.4: while a batch HD conversion runs, tiles are inert to
      // selection toggles — downloads match the confirmed selection.
      onLockChange: (locked) => this.#resultsView.setSelectionLocked(locked),
    });

    this.#startOverBtn.addEventListener("click", () => this.startOver());
  }

  init() {
    this.#view.renderEmpty("default");
    this.#setTitle("Blurry Photo Cleaner");
    this.#updateStartOver();
  }

  /** Snapshot for the §9b progress card; also read by e2e. */
  get analysisState() {
    return { ...this.#analysisState };
  }

  /**
   * Entry point for every intake path (picker, drop, folder). Files (or
   * unreadable-entry markers from folder walks) are queued in arrival order.
   */
  handleFilesChosen(items) {
    const list = Array.from(items ?? []).filter(Boolean);
    if (list.length === 0) {
      return;
    }
    this.#queue = this.#queue
      .then(() => this.#runBatch(list))
      .catch(() => {
        // Anything unexpected still surfaces visibly (§8.2) — never silent.
        this.#view.showError({
          body: "The photos couldn't be loaded. Nothing was changed.",
          onRetry: () => this.handleFilesChosen(list),
        });
      });
  }

  /** "Start over" clears everything (native confirm per §9c). Queued behind
   * any in-flight batch so a clear can never race a decode or analysis. */
  startOver() {
    this.#queue = this.#queue.then(() => this.#doStartOver());
  }

  #doStartOver() {
    if (this.#store.count === 0) {
      return;
    }
    const confirmed = window.confirm("Start over? Photos loaded in this session will be cleared.");
    if (!confirmed) {
      return;
    }
    this.#store.clear(); // revokes every thumbnail object URL
    this.#analyzer.dispose(); // release the worker thread; next batch starts fresh
    this.#hdConverter.dispose(); // same discipline for the upscale worker + probe cache
    this.#reviewControls.unmount(); // results action bar goes with the results
    this.#mode = "empty";
    this.#skippedNames = [];
    this.#noticeDismissed = false;
    this.#analysisSkippedNames = [];
    this.#analysisSkipDismissed = false;
    this.#oversizeNames = [];
    this.#oversizeDismissed = false;
    this.#overCountNames = [];
    this.#overCountDismissed = false;
    this.#analysisState = { phase: "idle", done: 0, total: 0, currentName: null };
    this.#view.renderEmpty("default"); // also removes any mounted §9e notice
    this.#setTitle("Blurry Photo Cleaner");
    this.#view.announce("Gallery cleared.");
    this.#updateStartOver();
  }

  /**
   * Dismiss callback from the §9e notices: the matching ledger clears with
   * it. kind is "undecodable" (Phase 2 intake skips), "analysis-skip"
   * (Phase 3 no-visible-pixel skips), "oversize" (INF-1 size cap), or
   * "over-count" (INF-1 batch cap).
   */
  handleNoticeDismissed(kind = "undecodable") {
    if (kind === "analysis-skip") {
      this.#analysisSkippedNames = [];
      this.#analysisSkipDismissed = true;
    } else if (kind === "oversize") {
      this.#oversizeNames = [];
      this.#oversizeDismissed = true;
    } else if (kind === "over-count") {
      this.#overCountNames = [];
      this.#overCountDismissed = true;
    } else {
      this.#skippedNames = [];
      this.#noticeDismissed = true;
    }
  }

  /* ------------------------------------------------------------------
     Pipeline
     ------------------------------------------------------------------ */

  async #runBatch(items) {
    const wasResults = this.#mode === "results";
    if (wasResults) {
      // §10: "Add more" re-enters §9b for the new files; the action bar
      // belongs to results and goes with them.
      this.#reviewControls.unmount();
      this.#view.setNoticeHost(null);
      this.#setTitle("Blurry Photo Cleaner");
    }
    this.#mode = "pending";

    const totalBefore = this.#store.count;
    const existing = this.#store.photos.slice();

    // INF-1: enforce the intake caps before any placeholder or decode —
    // oversize files are never read into memory, and over-count items
    // never enter the gallery. Both join their own skip ledgers below.
    const { accepted, oversizeNames, overCountNames } = partitionIntake(items);

    const placeholders = accepted.map((item) => ({
      id: this.#view.nextPlaceholderId(),
      name: describeIntakeName(item),
      size: typeof item.size === "number" && item.size >= 0 ? item.size : 0,
    }));
    this.#view.beginBatch(placeholders, totalBefore + placeholders.length, existing);

    // Decode-verify only what passed the caps; placeholder indices align
    // with `accepted` because both are built from the same array.
    const results = await runPool(accepted, DECODE_CONCURRENCY, async (item, index) => {
      const placeholder = placeholders[index];
      try {
        if (!(item instanceof File)) {
          throw new Error("Unreadable file entry");
        }
        const record = await this.#store.createRecord(item);
        this.#view.resolveTile(placeholder.id, record);
        return { ok: true };
      } catch {
        // Undecodable or unreadable: excluded from the gallery, counted in the
        // notice (plan Decision Record — never a silent drop).
        this.#view.failTile(placeholder.id);
        return { ok: false, name: placeholder.name };
      }
    });

    const skippedNames = results.filter((result) => !result.ok).map((result) => result.name);
    const addedCount = this.#store.count - totalBefore;

    this.#view.finishBatch({
      totalPhotos: this.#store.count,
      addedCount,
    });

    if (skippedNames.length > 0) {
      this.#skippedNames.push(...skippedNames);
      this.#noticeDismissed = false;
    }

    if (oversizeNames.length > 0) {
      this.#oversizeNames.push(...oversizeNames);
      this.#oversizeDismissed = false;
    }

    if (overCountNames.length > 0) {
      this.#overCountNames.push(...overCountNames);
      this.#overCountDismissed = false;
    }

    // §10: the notice shows in every later state until dismissed, and counts
    // everywhere exclude skipped files. The all-failed empty variant (§9e)
    // replaces the notice when nothing could be loaded at all. The INF-1
    // ledgers follow the identical pattern; the view has one notice slot,
    // so when several ledgers are pending the later card is the one
    // visible — each ledger re-surfaces on the next batch that adds to it,
    // exactly like the analysis-skip ledger.
    if (this.#skippedNames.length > 0 && !this.#noticeDismissed && this.#store.count > 0) {
      this.#view.showUndecodableNotice(this.#skippedNames);
    }

    if (this.#oversizeNames.length > 0 && !this.#oversizeDismissed && this.#store.count > 0) {
      this.#view.showOversizeNotice(this.#oversizeNames);
    }

    if (this.#overCountNames.length > 0 && !this.#overCountDismissed && this.#store.count > 0) {
      this.#view.showOverCountNotice(this.#overCountNames);
    }

    // Every file in the batch failed and nothing was loaded before:
    // §9e all-failed variant of the empty state. When size was the only
    // reason anything failed, the copy names the size limit instead of the
    // decode reason (INF-1 honest copy). The empty-state composition
    // carries no role="status" of its own, so the outcome must be announced
    // through the polite live region (WCAG 2.2 SC 4.1.3 — "no results
    // returned" is a status message). Both intake routes (picker, drop,
    // folder) funnel through this single call site.
    if (this.#store.count === 0) {
      this.#mode = "empty";
      const oversizeOnly = this.#skippedNames.length === 0 && this.#oversizeNames.length > 0;
      this.#view.renderEmpty(oversizeOnly ? "all-failed-oversize" : "all-failed");
      this.#view.announce(
        oversizeOnly
          ? "Those files were too large. Nothing was added."
          : "Couldn't open those files. Nothing was added.",
      );
      this.#updateStartOver();
      return;
    }

    this.#updateStartOver();

    // Phase 3: once the intake has settled, score the new photos. Awaiting
    // here keeps the whole pipeline (batch → analysis) serialized on the
    // queue, so start-over can never race a running analysis.
    if (addedCount > 0) {
      await this.#runAnalysis();
    } else if (wasResults) {
      // Nothing was added (every new file was skipped): back to the results
      // the user came from, with the notice rendered above them (§9e).
      this.#enterResults({ animate: false });
    }
  }

  /* ------------------------------------------------------------------
     Phase 3 — blur analysis
     ------------------------------------------------------------------ */

  /**
   * Analyze every not-yet-resolved photo in the store. Results land in the
   * store record as they arrive (progressive), and the tile chip fills in.
   * Skips (no visible pixels) join the analysis-skip ledger and surface as
   * a counted notice — never a silent drop, never a fake score of 0.
   * An unexpected worker failure shows the generic-error notice over the
   * pending grid; "Try again" re-queues only the photos still without a
   * band (spec §10). On success the view moves to the grouped results.
   */
  async #runAnalysis() {
    const pending = this.#store.unscored;
    if (pending.length === 0) {
      return;
    }

    this.#setAnalysisState({ phase: "analyzing", done: 0, total: pending.length, currentName: null });

    try {
      await this.#analyzer.analyzeAll(pending, {
        onProgress: ({ done, total, current }) => {
          this.#setAnalysisState({
            phase: "analyzing",
            done,
            total,
            currentName: current ? current.name : null,
          });
        },
        onResult: (photo, result) => {
          this.#store.applyAnalysis(photo.id, { score: result.score, band: result.band });
          this.#view.setTileScore(photo.id, result.score, result.band);
        },
        onSkipped: (photo, message) => {
          this.#store.applySkip(photo.id, message);
          this.#analysisSkippedNames.push(photo.name);
          this.#analysisSkipDismissed = false;
        },
      });
      this.#setAnalysisState({ phase: "idle", done: pending.length, total: pending.length, currentName: null });

      this.#enterResults({ animate: true });

      // §12: the completion counts go through the polite live region.
      this.#view.announce(this.#analysisCompleteMessage());

      if (this.#analysisSkippedNames.length > 0 && !this.#analysisSkipDismissed) {
        this.#view.showAnalysisSkippedNotice(this.#analysisSkippedNames);
      }
    } catch {
      // Worker crashed or a photo failed unexpectedly (spec §10: photos
      // already scored stay; retry re-queues only the unscored ones). The
      // pending grid stays visible with every tile — scored chips keep
      // their scores, unscored ones wait for the retry.
      const remaining = this.#store.unscored.length;
      this.#setAnalysisState({ phase: "failed", done: pending.length - remaining, total: pending.length, currentName: null });
      this.#view.showError({
        body: "Analysis stopped partway. Photos already scored keep their scores.",
        onRetry: () => {
          this.#queue = this.#queue.then(() => this.#runAnalysis());
        },
      });
    }
  }

  #setAnalysisState(state) {
    this.#analysisState = state;
    // Phase 4 seam (§9b): the view renders the progress card from every
    // transition and removes it on idle/failed.
    this.#view.onAnalysisProgress?.(this.analysisState);
    // §9b: the header keeps no buttons while analysis runs.
    this.#updateStartOver();
  }

  /* ------------------------------------------------------------------
     Phase 4 — results state transitions
     ------------------------------------------------------------------ */

  /**
   * Move the view root to the grouped results (§9c) and mount the action
   * bar. animate=true runs the §6.2 band reveal (analyzing → results).
   * Notices follow via the notice host so §9e cards stay first in flow.
   */
  #enterResults({ animate }) {
    this.#mode = "results";
    this.#resultsView.render(this.#store.photos, { animate });
    this.#view.setNoticeHost(this.#resultsView.noticeSlot);
    this.#reviewControls.mount(document.querySelector(".app") ?? document.body);
    this.#syncSelectionCount();
    this.#setTitle("Results");
    this.#updateStartOver();
  }

  #syncSelectionCount() {
    if (this.#mode === "results") {
      this.#reviewControls.setSummary(
        this.#resultsView.selectedCount,
        this.#store.count,
      );
    }
  }

  /**
   * §11.5.4 confirmed session delete (the dialog is the only gate): remove
   * the records — the store revokes their thumbnail URLs — then re-render
   * the results in place (§11.5.1: removal is instant, no exit animation,
   * no band-reveal re-run), re-show any pending §9e ledgers (the notice
   * host re-mounts with the results), sync the action bar, and fire the
   * ONE polite removal announcement (§11.5.4). When the last photo goes,
   * the app returns to the empty state (§10) with the same announcement —
   * re-adding files is the same honesty as "Start over" (no undo in v2).
   * Guarded to results mode so a stray call can never corrupt a pending
   * batch ("Delete selected" is disabled while a conversion runs).
   */
  #deletePhotos(ids) {
    if (this.#mode !== "results") {
      return;
    }
    const removed = this.#store.remove(ids);
    if (removed.length === 0) {
      return;
    }

    if (this.#store.count === 0) {
      this.#reviewControls.unmount();
      this.#view.setNoticeHost(null);
      this.#mode = "empty";
      this.#view.renderEmpty("default");
      this.#setTitle("Blurry Photo Cleaner");
      this.#updateStartOver();
    } else {
      this.#enterResults({ animate: false });
      // §10: pending ledgers re-surface above the re-rendered results
      // (the notice host re-mounts empty on every render).
      if (this.#skippedNames.length > 0 && !this.#noticeDismissed) {
        this.#view.showUndecodableNotice(this.#skippedNames);
      }
      if (this.#oversizeNames.length > 0 && !this.#oversizeDismissed) {
        this.#view.showOversizeNotice(this.#oversizeNames);
      }
      if (this.#overCountNames.length > 0 && !this.#overCountDismissed) {
        this.#view.showOverCountNotice(this.#overCountNames);
      }
      if (this.#analysisSkippedNames.length > 0 && !this.#analysisSkipDismissed) {
        this.#view.showAnalysisSkippedNotice(this.#analysisSkippedNames);
      }
    }

    // §11.5.4: one polite announcement, then silence — no toast, no undo.
    const n = removed.length;
    this.#view.announce(
      n === 1
        ? `${removed[0].name} removed from this session.`
        : `${n} photos removed from this session.`,
    );
  }

  /** §12 completion announcement: "Analysis complete: 12 blurry, 5 need review, 7 sharp". */
  #analysisCompleteMessage() {
    const photos = this.#store.photos;
    const blurry = photos.filter((p) => p.band === BAND_BLURRY).length;
    const review = photos.filter((p) => p.band === BAND_REVIEW).length;
    const sharp = photos.filter((p) => p.band === BAND_SHARP).length;
    return `Analysis complete: ${blurry} blurry, ${review} need review, ${sharp} sharp`;
  }

  #setTitle(text) {
    const title = this.#headerTitle;
    if (!title) {
      return;
    }
    // Keep the app mark; swap only the title text (§9c header: "Results").
    const mark = title.querySelector(".app-mark");
    while (mark && mark.nextSibling) {
      mark.nextSibling.remove();
    }
    if (mark) {
      title.appendChild(document.createTextNode(text));
    }
  }

  /**
   * Inspection snapshot for e2e (and future debugging): scores, bands, and
   * both skip ledgers without touching the DOM. Surfaced in main.js.
   */
  debugState() {
    return {
      analysis: this.analysisState,
      photos: this.#store.photos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        score: photo.score,
        band: photo.band,
        skipMessage: photo.skipMessage ?? null,
      })),
      skippedFiles: [...this.#skippedNames],
      skippedOversize: [...this.#oversizeNames],
      skippedOverCount: [...this.#overCountNames],
      skippedAnalysis: [...this.#analysisSkippedNames],
    };
  }

  #updateStartOver() {
    // §9b: the header keeps no buttons while analysis runs.
    this.#startOverBtn.hidden =
      this.#store.count === 0 || this.#analysisState.phase === "analyzing";
  }
}

/**
 * INF-1 intake caps: split a chosen batch into what may load and what must
 * be skipped, with the reason for each skip.
 *
 *   oversize — File instances larger than MAX_FILE_BYTES. Checked before
 *     any placeholder tile or decode attempt, so an oversize file is never
 *     read into memory.
 *   overCount — items beyond MAX_BATCH_FILES, applied AFTER the size filter
 *     so the count cap never wastes room on files that could not load
 *     anyway. Items within the cap keep loading (the plan's "valid files
 *     unaffected"); only the excess beyond the limit is rejected.
 *
 * Unreadable folder-walk markers ({ name, unreadable }) are not Files, so
 * they pass through to the decode path, which fails them into the
 * undecodable ledger as before (they stay inside the count cap — they are
 * tiny markers that never store anything).
 */
function partitionIntake(items) {
  const withinSizeCap = [];
  const oversizeNames = [];
  for (const item of items) {
    if (item instanceof File && item.size > MAX_FILE_BYTES) {
      oversizeNames.push(describeIntakeName(item));
    } else {
      withinSizeCap.push(item);
    }
  }

  const accepted = withinSizeCap.slice(0, MAX_BATCH_FILES);
  const overCountNames = withinSizeCap
    .slice(MAX_BATCH_FILES)
    .map((item) => describeIntakeName(item));

  return { accepted, oversizeNames, overCountNames };
}

/** Same name normalization the placeholder tiles use, so a ledger name
 *  always matches what the grid would have shown for that file. */
function describeIntakeName(item) {
  return typeof item?.name === "string" && item.name.length > 0 ? item.name : "Unnamed file";
}

/**
 * Run an async worker over items with a fixed number of in-flight tasks.
 * Results keep the input order; worker errors are the worker's own return
 * values (the pipeline never rejects).
 */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function lane() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const lanes = [];
  const laneCount = Math.min(limit, items.length);
  for (let i = 0; i < laneCount; i += 1) {
    lanes.push(lane());
  }
  await Promise.all(lanes);
  return results;
}
