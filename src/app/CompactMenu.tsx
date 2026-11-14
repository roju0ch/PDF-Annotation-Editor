import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";

function dismissMenu(target: string) {
  document.getElementById(target)?.hidePopover();
  document
    .querySelector<HTMLButtonElement>(
      `header button[popovertarget="${target}"]`,
    )
    ?.focus();
}
export function useMenuKeyboard() {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Firefox can move focus to the document when a form button becomes
      // disabled. Handle Escape even when focus is no longer inside the menu.
      const menu = document.querySelector<HTMLElement>(
        ".compact-menu:popover-open",
      );
      if (menu) {
        event.preventDefault();
        dismissMenu(menu.id);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
}
const paths = {
  pages: "M8 3h12v15H8V3ZM4 7v14h12",
  select: "m4 3 6 18 3-8 8-3L4 3Z",
  note: "M4 3h16v12l-6 6H4V3Zm10 18v-7h6M8 7h8M8 11h5",
  text: "M3 4h18v16H3V4Zm5 4h8M12 8v8M10 16h4",
  image: "M3 4h18v16H3V4Zm0 12 6-6 5 5 3-3 4 4M16 8h.01",
  eraser: "m3 15 11-11 7 7-10 10H9l-6-6Zm5-5 7 7M11 21h10",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
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

export function ToolButton({
  icon,
  label,
  pressed,
  disabled,
  onClick,
  popoverTarget,
}: {
  icon: keyof typeof paths;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  popoverTarget?: string;
}) {
  const [visible, setVisible] = useState(false);
  const button = useRef<HTMLButtonElement>(null),
    tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!visible) return;
    const position = () => {
      const anchor = button.current!.getBoundingClientRect(),
        el = tip.current!;
      const bounds = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(anchor.x + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8))}px`;
      el.style.top = `${Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [visible]);
  return (
    <button
      ref={button}
      className="icon-button tool-button"
      aria-label={label}
      aria-pressed={pressed}
      aria-describedby={visible ? id : undefined}
      disabled={disabled}
      popoverTarget={popoverTarget}
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") setVisible(true);
      }}
      onPointerLeave={() => {
        if (!button.current?.matches(":focus-visible")) setVisible(false);
      }}
      onFocus={() => {
        if (button.current?.matches(":focus-visible")) setVisible(true);
      }}
      onBlur={() => setVisible(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && visible) {
          setVisible(false);
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={() => {
        setVisible(false);
        onClick?.();
      }}
    >
      <Icon name={icon} />
      {visible && (
        <span ref={tip} id={id} role="tooltip" className="tool-tooltip">
          {label}
        </span>
      )}
    </button>
  );
}
