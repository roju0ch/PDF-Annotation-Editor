import { useEffect, useRef } from "react";
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
  useEffect(() => {
    current.current = { canOpen, onFile, onError };
    controller.current?.wake();
  }, [canOpen, onFile, onError]);
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
