import { useEffect, useLayoutEffect, useRef } from "react";
import {
  subscribePdfOpens,
  type PdfOpenOutcome,
} from "../adapters/platform/openPdf";

/** OS requests wait through editor transactions and always use the shared importer. */
export function usePdfOpen(
  canOpen: boolean,
  onFile: (file: File) => Promise<PdfOpenOutcome>,
  onError: (message: string) => void,
) {
  const current = useRef({ canOpen, onFile, onError });
  const controller = useRef<ReturnType<typeof subscribePdfOpens> | null>(null);
  useLayoutEffect(() => {
    current.current = { canOpen, onFile, onError };
  }, [canOpen, onFile, onError]);
  useEffect(() => {
    // View/annotation renders may update callbacks without a new OS request.
    // Resume only known pending work, including a transaction that deferred
    // and became ready again before React rendered the intermediate busy state.
    controller.current?.resume();
  });
  useEffect(() => {
    const subscription = subscribePdfOpens({
      canOpen: () => current.current.canOpen,
      onFile: (file) => current.current.onFile(file),
      onError: (message) => current.current.onError(message),
    });
    controller.current = subscription;
    return () => {
      controller.current = null;
      subscription.dispose();
    };
  }, []);
}
