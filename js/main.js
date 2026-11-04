/**
 * main.js — bootstrap. Wires the DOM to the App / PhotoStore / UploadView
 * trio and boots once the document is parsed.
 */

import { App } from "./App.js";
import { PhotoStore } from "./PhotoStore.js";
import { UploadView } from "./UploadView.js";

function boot() {
  const contentEl = document.getElementById("content");
  const viewRoot = document.getElementById("view-root");
  const liveRegion = document.getElementById("live-region");
  const fileInput = document.getElementById("file-input");
  const startOverBtn = document.getElementById("start-over-btn");

  if (!contentEl || !viewRoot || !liveRegion || !fileInput || !startOverBtn) {
    // Markup contract broken — do not half-boot. Loud, because a silent
    // blank page would hide the failure from whoever is serving the app.
    console.error("Blurry Photo Cleaner: required DOM elements are missing — check index.html.");
    return;
  }

  let app;
  const view = new UploadView({
    contentEl,
    viewRoot,
    liveRegion,
    fileInput,
    callbacks: {
      onFilesChosen: (items) => app.handleFilesChosen(items),
      // kind is "undecodable" or "analysis-skip" — App clears that ledger.
      onNoticeDismissed: (kind) => app.handleNoticeDismissed(kind),
    },
  });

  app = new App({ store: new PhotoStore(), view, startOverBtn });
  app.init();

  // Inspection seam for e2e and debugging: reads state without touching the
  // DOM. Phase 4's real analyzing/results UI will supersede its e2e use.
  window.__debugState = () => app.debugState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
