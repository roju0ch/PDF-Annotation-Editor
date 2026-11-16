import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import type { AnnotationControls } from "./useAnnotations";

/** Draft text is held in memory; the native PDF transaction starts only on OK. */
export function FreeTextDialog({
  editor: e,
  returnFocus,
}: {
  editor: AnnotationControls;
  returnFocus: RefObject<HTMLDivElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const title = useId();
  const open = e.freeTextDraft !== null;
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const focusTarget = returnFocus.current;
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
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    };
  }, [open, returnFocus]);
  const draft = e.freeTextDraft;
  if (!draft) return null;
  const style = e.freeTextDialogStyle;
  const original = draft.annotation;
  const note = original?.type === "Text";
  const heading = original
    ? note
      ? "Notiz bearbeiten"
      : "Textkommentar bearbeiten"
    : "Textkommentar erstellen";
  const valid =
    ((!!original && (note || !original.autoSize)) || !!draft.contents.trim()) &&
    draft.contents.length <= 10000 &&
    (note ||
      (original && style.fontSize === original.fontSize) ||
      (Number.isFinite(style.fontSize) &&
        style.fontSize >= 6 &&
        style.fontSize <= 96));
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
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !e.busy) void e.confirmFreeText();
        }}
      >
        <h2 id={title}>{heading}</h2>
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
          {!note && (
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
                    e.setFreeTextDialogStyle((previous) => ({
                      ...previous,
                      fontSize: Number(event.target.value),
                    }))
                  }
                />{" "}
                pt
              </span>
            </label>
          )}
          <label>
            {note ? "Notizfarbe" : "Textfarbe"}
            <input
              type="color"
              aria-label={note ? "Notizfarbe" : "Textfarbe"}
              value={style.color}
              disabled={e.busy}
              onChange={(event) =>
                e.setFreeTextDialogStyle((previous) => ({
                  ...previous,
                  color: event.target.value,
                }))
              }
            />
          </label>
          {!note && (
            <label>
              Hintergrundfarbe
              <input
                type="color"
                aria-label="Hintergrundfarbe"
                value={style.backgroundColor}
                disabled={e.busy || style.transparent}
                onChange={(event) =>
                  e.setFreeTextDialogStyle((previous) => ({
                    ...previous,
                    backgroundColor: event.target.value,
                  }))
                }
              />
            </label>
          )}
        </div>
        {!note && (
          <label className="free-text-transparent">
            <input
              type="checkbox"
              checked={style.transparent}
              disabled={e.busy}
              onChange={(event) =>
                e.setFreeTextDialogStyle((previous) => ({
                  ...previous,
                  transparent: event.target.checked,
                }))
              }
            />
            Transparenter Hintergrund
          </label>
        )}
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
            {e.busy
              ? original
                ? "Speichern …"
                : "Erstellen …"
              : original
                ? "Übernehmen"
                : "OK"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
