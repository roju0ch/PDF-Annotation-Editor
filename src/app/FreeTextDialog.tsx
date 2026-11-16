import { useId, useLayoutEffect, useRef } from "react";
import type { AnnotationControls } from "./useAnnotations";

/** Draft text is held in memory; the native PDF transaction starts only on OK. */
export function FreeTextDialog({ editor: e }: { editor: AnnotationControls }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const title = useId();
  const open = e.freeTextDraft !== null;
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const viewport = window.visualViewport;
    const position = () => {
      element.style.setProperty(
        "--free-text-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      element.style.setProperty(
        "--free-text-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    position();
    element.showModal();
    textarea.current?.focus({ preventScroll: true });
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
      if (element.open) element.close();
    };
  }, [open]);
  const draft = e.freeTextDraft;
  if (!draft) return null;
  const style = e.freeTextStyle;
  const valid =
    !!draft.contents.trim() &&
    draft.contents.length <= 10000 &&
    Number.isFinite(style.fontSize) &&
    style.fontSize >= 6 &&
    style.fontSize <= 96;
  return (
    <dialog
      ref={dialog}
      className="free-text-dialog"
      aria-labelledby={title}
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const element = event.currentTarget;
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            "textarea:not(:disabled),input:not(:disabled),button:not(:disabled)",
          ),
        ].filter(
          (control) => control.tabIndex >= 0 && control.getClientRects().length,
        );
        // Some WebViews include the document body in a native dialog's tab
        // cycle. Keep each Tab step inside this modal, including both ends.
        event.preventDefault();
        if (!controls.length) {
          element.focus();
          return;
        }
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next =
          index < 0
            ? event.shiftKey
              ? controls.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length;
        controls[next].focus();
      }}
      onCancel={(event) => {
        // Android Back and the browser dialog-cancel mechanism use the same
        // cancellation path as the application's central Escape handler.
        event.preventDefault();
        e.cancelFreeText();
      }}
    >
      <form
        className="free-text-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !e.busy) void e.confirmFreeText();
        }}
      >
        <h2 id={title}>Textkommentar erstellen</h2>
        <label>
          Text
          <textarea
            ref={textarea}
            aria-label="Textkommentar"
            rows={5}
            maxLength={10000}
            value={draft.contents}
            disabled={e.busy}
            onChange={(event) => e.setFreeTextContents(event.target.value)}
          />
        </label>
        <div className="free-text-style">
          <label>
            Schriftgröße
            <span>
              <input
                type="number"
                aria-label="Schriftgröße"
                min={6}
                max={96}
                step={1}
                value={style.fontSize}
                disabled={e.busy}
                onChange={(event) =>
                  e.setFreeTextStyle((previous) => ({
                    ...previous,
                    fontSize: Number(event.target.value),
                  }))
                }
              />{" "}
              pt
            </span>
          </label>
          <label>
            Textfarbe
            <input
              type="color"
              aria-label="Textfarbe"
              value={style.color}
              disabled={e.busy}
              onChange={(event) =>
                e.setFreeTextStyle((previous) => ({
                  ...previous,
                  color: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Hintergrundfarbe
            <input
              type="color"
              aria-label="Hintergrundfarbe"
              value={style.backgroundColor}
              disabled={e.busy || style.transparent}
              onChange={(event) =>
                e.setFreeTextStyle((previous) => ({
                  ...previous,
                  backgroundColor: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <label className="free-text-transparent">
          <input
            type="checkbox"
            checked={style.transparent}
            disabled={e.busy}
            onChange={(event) =>
              e.setFreeTextStyle((previous) => ({
                ...previous,
                transparent: event.target.checked,
              }))
            }
          />
          Transparenter Hintergrund
        </label>
        {draft.error && (
          <p className="free-text-error" role="alert">
            {draft.error}
          </p>
        )}
        <div className="free-text-actions">
          <button type="button" disabled={e.busy} onClick={e.cancelFreeText}>
            Abbrechen
          </button>
          <button type="submit" disabled={!valid || e.busy}>
            {e.busy ? "Erstellen …" : "OK"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
