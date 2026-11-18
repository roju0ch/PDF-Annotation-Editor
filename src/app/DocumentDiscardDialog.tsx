import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type PendingDecision = {
  promise: Promise<boolean>;
  resolve: (discard: boolean) => void;
  focus: HTMLElement | null;
};
export type DocumentDiscardAction = "open" | "close";

/** A shared app modal also works in WebViews without JavaScript confirm UI. */
export function useDocumentDiscardDialog(
  returnFocus: RefObject<HTMLDivElement | null>,
) {
  const pending = useRef<PendingDecision | null>(null);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<DocumentDiscardAction>("open");
  const request = useCallback((nextAction: DocumentDiscardAction = "open") => {
    if (pending.current) return pending.current.promise;
    let resolve!: (discard: boolean) => void;
    const promise = new Promise<boolean>((answer) => {
      resolve = answer;
    });
    pending.current = {
      promise,
      resolve,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    };
    setAction(nextAction);
    setOpen(true);
    return promise;
  }, []);
  const decide = useCallback((discard: boolean) => {
    const decision = pending.current;
    if (!decision) return;
    pending.current = null;
    setOpen(false);
    decision.resolve(discard);
  }, []);
  const focusTarget = useCallback(
    () => pending.current?.focus ?? returnFocus.current,
    [returnFocus],
  );
  useEffect(
    () => () => {
      const decision = pending.current;
      pending.current = null;
      // An unmounted importer must never leave a native queue request hanging.
      decision?.resolve(false);
    },
    [],
  );
  return {
    request,
    dialog: (
      <DocumentDiscardDialog
        open={open}
        action={action}
        onDecision={decide}
        focusTarget={focusTarget}
        returnFocus={returnFocus}
      />
    ),
  };
}

function DocumentDiscardDialog({
  open,
  action,
  onDecision,
  focusTarget,
  returnFocus,
}: {
  open: boolean;
  action: DocumentDiscardAction;
  onDecision: (discard: boolean) => void;
  focusTarget: () => HTMLElement | null;
  returnFocus: RefObject<HTMLDivElement | null>;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const title = useId();
  const description = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = element.current!;
    const previous = focusTarget();
    const fallback = returnFocus.current;
    dialog.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      // The importer releases its edit lock in the promise continuation. Wait
      // until then before focusing a temporarily disabled underlying text field.
      requestAnimationFrame(() => {
        const target =
          previous?.isConnected && !previous.matches(":disabled")
            ? previous
            : fallback;
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [open, focusTarget, returnFocus]);
  if (!open) return null;
  return (
    <dialog
      ref={element}
      className="document-discard-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      aria-modal="true"
      onKeyDown={(event) => {
        // In particular Escape must not cancel an underlying text-comment
        // draft, and editor shortcuts must not operate behind this modal.
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onDecision(false);
        } else if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
        } else if (event.key === "Tab") {
          const buttons = [...event.currentTarget.querySelectorAll("button")];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          event.preventDefault();
          buttons[
            (index + (event.shiftKey ? -1 : 1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
      }}
      onPaste={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onDecision(false);
      }}
      onClose={() => onDecision(false)}
    >
      <h2 id={title}>Ungesicherte Änderungen</h2>
      <p id={description}>
        {action === "close"
          ? "Ungesicherte Änderungen verwerfen und dieses Fenster schließen?"
          : "Ungesicherte Änderungen verwerfen und eine andere PDF öffnen?"}
      </p>
      <div className="document-discard-actions">
        <button ref={cancel} type="button" onClick={() => onDecision(false)}>
          Abbrechen
        </button>
        <button type="button" onClick={() => onDecision(true)}>
          {action === "close"
            ? "Verwerfen und schließen"
            : "Verwerfen und öffnen"}
        </button>
      </div>
    </dialog>
  );
}
