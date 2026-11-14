import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { AnnotationContext, AnnotationControls } from "./useAnnotations";

export function AnnotationContextMenu({
  editor,
  context,
  stage,
}: {
  editor: AnnotationControls;
  context: AnnotationContext;
  stage: RefObject<HTMLDivElement | null>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const { closeContext } = editor;
  useLayoutEffect(() => {
    const el = menu.current!;
    const bounds = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(context.screen.x, window.innerWidth - bounds.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(context.screen.y, window.innerHeight - bounds.height - 8))}px`;
    el.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    )?.focus({ preventScroll: true });
  }, [context]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeContext();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeContext();
        stage.current?.focus({ preventScroll: true });
      }
    };
    const blur = () => closeContext();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", blur);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", blur);
      window.removeEventListener("blur", blur);
    };
  }, [closeContext, stage]);
  const activate = (action: () => void) => {
    action();
    closeContext();
    stage.current?.focus({ preventScroll: true });
  };
  return (
    <div
      ref={menu}
      className="annotation-context-menu"
      role="menu"
      aria-label="Annotationsaktionen"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(e.key))
          return;
        if (e.key === "Tab") {
          closeContext();
          return;
        }
        e.preventDefault();
        const buttons = [
          ...menu.current!.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {context.mode === "selection" ? (
        <>
          <button
            role="menuitem"
            disabled={editor.busy || editor.selection.length === 0}
            onClick={() => activate(() => void editor.copySelection())}
          >
            Kopieren <kbd>Strg+C</kbd>
          </button>
          <button
            role="menuitem"
            disabled={editor.busy || editor.selection.length === 0}
            onClick={() => activate(() => void editor.copySelection(true))}
          >
            Ausschneiden <kbd>Strg+X</kbd>
          </button>
        </>
      ) : (
        <>
          <button
            role="menuitem"
            disabled={editor.busy || !editor.hasClipboard}
            onClick={() => activate(() => void editor.paste())}
          >
            Einfügen <kbd>Strg+V</kbd>
          </button>
          <button
            role="menuitem"
            disabled={
              editor.busy ||
              !editor.items.some((a) => a.editable && a.page === context.page)
            }
            onClick={() => activate(editor.selectAll)}
          >
            Alle Kommentare markieren <kbd>Strg+A</kbd>
          </button>
        </>
      )}
      <button role="menuitem" onClick={() => activate(closeContext)}>
        Schließen
      </button>
    </div>
  );
}
