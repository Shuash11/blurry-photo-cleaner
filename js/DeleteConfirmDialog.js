/**
 * DeleteConfirmDialog — the §11.5.3 confirmation dialog: ONE dialog for all
 * three delete triggers (per-tile, detail view, batch "Delete selected").
 *
 * Contract (design-spec-v2 §11.5.3, APG Dialog pattern):
 *   - white card (surface, hairline, radius-lg, shadow-floating, 20px
 *     padding) over --color-scrim, max-width 400px on BOTH breakpoints —
 *     a confirm dialog is compact; on mobile it floats as a card with
 *     16px margins rather than becoming a full-screen sheet
 *   - title counts ("Delete {N} photos from this session?" — never "these
 *     photos": the user must know the size of what they confirm)
 *   - body restates the device reality; filenames are readable BEFORE the
 *     deletion: inline mono for N=1, a <details> disclosure for N>1
 *   - focus starts on Cancel (the least destructive action, APG); Tab is
 *     trapped; Escape and scrim click are BOTH Cancel; there is no confirm
 *     shortcut — Return activates the focused button (Cancel by default)
 *   - on cancel: nothing changed, focus returns to the invoking control
 *   - on confirm: onConfirm() runs (the caller owns the deletion, the
 *     re-render, and the post-delete focus fallback — §11.5.4); the
 *     invoker often no longer exists then, so no focus is restored
 *   - stacks over the detail modal when opened from there (z-index 60 > 50)
 *
 * Zero new hex: the destructive button is .btn-text + .btn-delete
 * (--color-band-blurry-text on the white card, §4.9 pair 20: 6.52:1).
 */

export class DeleteConfirmDialog {
  #root = null;
  #panel = null;
  #trigger = null;
  #onConfirm = null;

  get isOpen() {
    return this.#root !== null;
  }

  /**
   * photos: the records to be deleted (names + count drive the copy).
   * trigger: the invoking control (focus returns here on cancel).
   * onConfirm: called after the dialog has closed itself — the caller
   * performs the deletion and the §11.5.4 focus fallback chain.
   */
  open({ photos, trigger = null, onConfirm }) {
    this.close(); // never two overlays
    if (!photos || photos.length === 0) {
      return;
    }
    this.#trigger = trigger ?? null;
    this.#onConfirm = onConfirm ?? null;

    const n = photos.length;
    const singular = n === 1;

    const root = document.createElement("div");
    root.className = "confirm";
    // Scrim click = Cancel (§11.5.3 focus rule 3). Clicks on the card
    // itself bubble but never match the root, so only true scrim clicks
    // cancel.
    root.addEventListener("click", (event) => {
      if (event.target === root) {
        this.close();
      }
    });

    const panel = document.createElement("section");
    panel.className = "confirm__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "confirm-title");
    panel.setAttribute("aria-describedby", "confirm-body");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => this.#onPanelKeydown(event));
    root.appendChild(panel);
    this.#panel = panel;

    const title = document.createElement("h2");
    title.id = "confirm-title";
    title.className = "confirm__title";
    title.textContent = singular
      ? "Delete 1 photo from this session?"
      : `Delete ${n} photos from this session?`;
    panel.appendChild(title);

    const body = document.createElement("div");
    body.id = "confirm-body";
    panel.appendChild(body);

    if (singular) {
      // §11.5.3: for N = 1 the filename is inline in the body (mono) — the
      // dialog is where filenames are read BEFORE they leave the gallery.
      const line = document.createElement("p");
      line.className = "confirm__text";
      const name = document.createElement("span");
      name.className = "confirm__filename";
      name.textContent = photos[0].name;
      line.append(
        document.createTextNode("The file "),
        name,
        document.createTextNode(
          " will be removed from this review session. The file on your phone isn't touched — to free space, delete it on your phone.",
        ),
      );
      body.appendChild(line);
    } else {
      const line = document.createElement("p");
      line.className = "confirm__text";
      line.textContent = `${n} photos will be removed from this review session. Files on your phone aren't touched — to free space, delete these filenames on your phone.`;
      body.appendChild(line);

      // §9e disclosure pattern: collapsed by default, per-dialog state.
      const details = document.createElement("details");
      details.className = "confirm__details";
      const summary = document.createElement("summary");
      summary.className = "confirm__summary";
      summary.textContent = `See the ${n} filenames`;
      details.appendChild(summary);
      const list = document.createElement("ul");
      list.className = "confirm__list";
      for (const photo of photos) {
        const item = document.createElement("li");
        item.className = "confirm__list-item";
        item.textContent = photo.name;
        list.appendChild(item);
      }
      details.appendChild(list);
      body.appendChild(details);
    }

    const actions = document.createElement("div");
    actions.className = "confirm__actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    actions.appendChild(cancel);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-text btn-delete";
    del.textContent = "Delete";
    // HIG Buttons: a destructive action never takes the primary role — red
    // TEXT on the white card (§4.9 pair 20: 6.52:1), never the accent fill.
    del.addEventListener("click", () => {
      const confirm = this.#onConfirm;
      this.close({ restoreFocus: false }); // invoker often won't survive
      confirm?.();
    });
    actions.appendChild(del);

    panel.appendChild(actions);
    this.#root = root;
    document.body.appendChild(root);
    // §11.5.3 focus rule 1: focus moves to Cancel — the least destructive
    // action and the safe default at every layer.
    cancel.focus();
  }

  /**
   * Close the dialog. restoreFocus=true (cancel paths) returns focus to
   * the invoking control when it still exists; the confirm path passes
   * false because §11.5.4's fallback chain owns focus after deletion.
   */
  close({ restoreFocus = true } = {}) {
    if (!this.#root) {
      return;
    }
    this.#root.remove();
    this.#root = null;
    this.#panel = null;
    if (restoreFocus && this.#trigger && document.contains(this.#trigger)) {
      this.#trigger.focus({ preventScroll: true });
    }
    this.#trigger = null;
    this.#onConfirm = null;
  }

  /* ------------------------------------------------------------------
     Focus containment (APG dialog pattern, as in BatchHDDialog)
     ------------------------------------------------------------------ */

  #onPanelKeydown(event) {
    if (event.key === "Escape") {
      // §11.5.3: Escape = Cancel — there is no confirm shortcut.
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = [
      ...this.#panel.querySelectorAll("button:not([disabled])"),
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
