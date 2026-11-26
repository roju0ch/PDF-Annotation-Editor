import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Point as TextPoint } from "mupdf";
import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo, TextSelection, TextQuery } from "../adapters/pdf/types";
import { containsPoint, edge } from "../adapters/pdf/text";
import { writeClipboardText } from "../adapters/platform/clipboard";
import type { Point } from "../core/viewport";
import { openControlSelector } from "./CompactMenu";

type Selection = TextSelection & { page: number };
type Locate = (
  p: Point,
  forced?: number,
) => { page: number; point: Point } | null;
type Drag = {
  page: number;
  anchor: TextPoint;
  offset: TextPoint;
  last: TextPoint;
};
const noText = "Auf dieser Seite wurde kein auslesbarer Text gefunden.";

export function usePdfText(
  active: boolean,
  client: RefObject<PdfClient | null>,
  pages: PageInfo[],
  page: number,
  locate: Locate,
) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [handles, setHandles] = useState(false);
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState("");
  const [pending, setPending] = useState(false);
  const drag = useRef<Drag | null>(null);
  const version = useRef(0);
  const running = useRef(false);
  const queued = useRef<(() => Promise<void>) | null>(null);

  const invalidate = useCallback(() => {
    version.current++;
    queued.current = null;
  }, []);

  const clear = useCallback(() => {
    invalidate();
    drag.current = null;
    setSelection(null);
    setHandles(false);
    setNotice("");
    setFallback("");
    setPending(false);
  }, [invalidate]);

  const request = useCallback(
    (index: number, query: TextQuery) => {
      const worker = client.current,
        info = pages[index];
      if (!worker || !info) return;
      const id = ++version.current;
      setPending(true);
      setNotice("");
      queued.current = async () => {
        try {
          const reply = await worker.request({
            type: "select-text",
            page: index,
            pageId: info.id,
            rotation: info.rotation,
            query,
          });
          if (version.current !== id || worker !== client.current) return;
          const result = reply.textSelection;
          setSelection(result?.text ? { ...result, page: index } : null);
          if (result && !result.readable) setNotice(noText);
        } catch (error) {
          if (version.current === id && worker === client.current) {
            setSelection(null);
            setNotice(
              error instanceof Error
                ? error.message
                : "Textauswahl fehlgeschlagen.",
            );
          }
        } finally {
          if (version.current === id) setPending(false);
        }
      };
      if (running.current) return;
      running.current = true;
      void (async () => {
        while (queued.current) {
          const next = queued.current;
          queued.current = null;
          await next();
        }
        running.current = false;
      })();
    },
    [client, pages],
  );

  useLayoutEffect(() => {
    clear();
    if (active) request(page, { mode: "probe" });
    return invalidate;
  }, [active, page, clear, request, invalidate]);

  const copy = useCallback(async () => {
    if (!selection || pending) return;
    const id = version.current;
    try {
      await writeClipboardText(selection.text);
      if (version.current === id) setNotice("Text kopiert");
    } catch {
      if (version.current === id) {
        setNotice("");
        setFallback(selection.text);
      }
    }
  }, [selection, pending]);

  useLayoutEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.altKey ||
        !(e.metaKey || e.ctrlKey) ||
        (e.target instanceof Element &&
          e.target.closest(
            "input,textarea,select,[contenteditable]:not([contenteditable=false])",
          )) ||
        document.querySelector(openControlSelector)
      )
        return;
      const action = e.key.toLowerCase();
      if (!["a", "c", "x"].includes(action)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (action === "a") {
        drag.current = null;
        request(page, { mode: "all" });
      }
      if (action === "c") void copy();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, copy, page, request]);

  function begin(p: Point, handle?: string) {
    const at = locate(p, handle ? selection?.page : undefined);
    if (!at) {
      clear();
      return false;
    }
    const point: TextPoint = [at.point.x, at.point.y];
    let anchor = point,
      offset: TextPoint = [0, 0];
    if (handle && selection?.quads.length) {
      const first = edge(selection.quads[0], false);
      const last = edge(selection.quads.at(-1)!, true);
      const tip = handle === "start" ? first : last;
      anchor = handle === "start" ? last : first;
      offset = [tip[0] - point[0], tip[1] - point[1]];
    } else {
      clear();
      request(at.page, { mode: "probe" });
    }
    drag.current = { page: at.page, anchor, offset, last: point };
    return true;
  }
  function move(p: Point) {
    const d = drag.current;
    if (!d) return;
    const at = locate(p, d.page);
    if (!at || (at.point.x === d.last[0] && at.point.y === d.last[1])) return;
    d.last = [at.point.x, at.point.y];
    request(d.page, {
      mode: "range",
      start: d.anchor,
      end: [d.last[0] + d.offset[0], d.last[1] + d.offset[1]],
    });
  }
  function word(p: Point, touch = false) {
    clear();
    setHandles(touch);
    const at = locate(p);
    if (at) request(at.page, { mode: "word", at: [at.point.x, at.point.y] });
  }
  return {
    selection,
    handles,
    notice,
    fallback,
    setFallback,
    pending,
    copy,
    clear,
    begin,
    move,
    word,
    contains: (p: Point) => {
      const at = locate(p);
      if (!at || !selection || selection.page !== at.page) return false;
      const point: TextPoint = [at.point.x, at.point.y];
      return selection.quads.some((q) => containsPoint(q, point));
    },
    finish: () => {
      drag.current = null;
    },
  };
}
