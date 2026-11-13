import type { KeyboardEvent, ReactNode } from "react";

function dismissMenu(target: string) {
  document.getElementById(target)?.hidePopover();
  document
    .querySelector<HTMLButtonElement>(
      `header button[popovertarget="${target}"]`,
    )
    ?.focus();
}
export function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismissMenu(event.currentTarget.id);
  }
}
const paths = {
  open: "M3 7h6l2-3h10v16H3V7Zm0 4h18",
  pen: "m4 16-1 5 5-1L21 7l-4-4L4 16Zm10-10 4 4",
  list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
  undo: "m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14",
  redo: "m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  chevron: "m7 10 5 5 5-5",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function MenuHeading({
  target,
  children,
}: {
  target: string;
  children: ReactNode;
}) {
  return (
    <div className="menu-heading">
      <h2>{children}</h2>
      <button
        onClick={() => dismissMenu(target)}
        aria-label="Menü schließen"
        title="Schließen"
      >
        ×
      </button>
    </div>
  );
}
