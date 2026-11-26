import { useLayoutEffect, useRef } from "react";
import type { PageInfo, TextSelection } from "../adapters/pdf/types";
import { edge } from "../adapters/pdf/text";

export function PdfTextOverlay({
  info,
  selection,
  scale,
  handles,
}: {
  handles: boolean;
  info: PageInfo;
  selection: TextSelection;
  scale: number;
}) {
  const { quads } = selection;
  if (!quads.length) return null;
  return (
    <>
      <svg
        className="pdf-text-highlight"
        width={info.width}
        height={info.height}
        viewBox={`${info.origin[0]} ${info.origin[1]} ${info.width} ${info.height}`}
        aria-hidden="true"
      >
        {quads.map((q, i) => (
          <polygon
            key={i}
            points={`${q[0]},${q[1]} ${q[2]},${q[3]} ${q[6]},${q[7]} ${q[4]},${q[5]}`}
          />
        ))}
      </svg>
      {handles &&
        ["start", "end"].map((handle) => {
          const end = handle === "end";
          const [x, y] = edge(end ? quads[quads.length - 1] : quads[0], end);
          return (
            <span
              key={handle}
              data-text-handle={handle}
              aria-hidden="true"
              style={{
                left: x - info.origin[0],
                top: y - info.origin[1],
                transform: `scale(${1 / scale}) translate(${end ? "0" : "-100%"}, ${end ? "0" : "-100%"})`,
              }}
            />
          );
        })}
    </>
  );
}

export function ManualTextCopy({
  text,
  close,
}: {
  text: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    field.current!.select();
    return () => el.close();
  }, []);
  return (
    <dialog ref={dialog} aria-label="Text manuell kopieren" onCancel={close}>
      <p>
        Der Zugriff auf die Zwischenablage ist fehlgeschlagen. Den markierten
        Text über das Systemmenü oder mit Strg/Cmd+C kopieren.
      </p>
      <textarea
        ref={field}
        readOnly
        aria-label="Ausgewählter PDF-Text"
        value={text}
      />
      <button onClick={close}>Schließen</button>
    </dialog>
  );
}
