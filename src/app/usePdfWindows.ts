import { useEffect, useLayoutEffect, useRef } from "react";
import {
  subscribePdfWindow,
  type PdfWindowState,
} from "../adapters/platform/pdfWindows";

export function usePdfWindows(
  state: PdfWindowState,
  askDiscard: () => Promise<boolean>,
  onError: (message: string) => void,
) {
  const current = useRef({ state, askDiscard, onError });
  const controller = useRef<ReturnType<typeof subscribePdfWindow> | null>(null);
  useLayoutEffect(() => {
    current.current = { state, askDiscard, onError };
  }, [state, askDiscard, onError]);
  useEffect(() => {
    const subscription = subscribePdfWindow({
      getState: () => current.current.state,
      askDiscard: () => current.current.askDiscard(),
      onError: (message) => current.current.onError(message),
    });
    controller.current = subscription;
    subscription.report(current.current.state);
    return () => {
      controller.current = null;
      subscription.dispose();
    };
  }, []);
  useEffect(() => {
    controller.current?.report({
      hasDocument: state.hasDocument,
      unsaved: state.unsaved,
      busy: state.busy,
      fileName: state.fileName,
      pageCount: state.pageCount,
    });
  }, [
    state.hasDocument,
    state.unsaved,
    state.busy,
    state.fileName,
    state.pageCount,
  ]);
}
