import type { Payload, Reply } from "./types";
export class PdfClient {
  private worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  private next = 0;
  private closed: string | null = null;
  private markReady!: () => void;
  private ready = new Promise<void>((resolve) => {
    this.markReady = resolve;
  });
  private pending = new Map<
    number,
    {
      resolve: (r: Reply) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data: r }: MessageEvent<Reply>) => {
      if (r.id === 0) {
        this.markReady();
        return;
      }
      const p = this.pending.get(r.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(r.id);
      if (r.error) p.reject(new Error(r.error));
      else p.resolve(r);
    };
    this.worker.onerror = () =>
      this.dispose("PDF-Modul konnte nicht geladen werden. Bitte neu öffnen.");
  }
  request(payload: Payload): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.dispose(
            "Zeitlimit beim Verarbeiten der PDF erreicht. Bitte eine kleinere Datei öffnen.",
          ),
        30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      void this.ready.then(() => {
        if (this.pending.has(id))
          this.worker.postMessage(
            { ...payload, id },
            payload.type === "open" ? [payload.data] : [],
          );
      });
    });
  }
  dispose(message = "Vorgang abgebrochen.") {
    this.closed = message;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
}
