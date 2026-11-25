import { isTauri } from "@tauri-apps/api/core";

declare global {
  interface Window {
    readonly __PDF_IOS_APP__?: boolean;
  }
}

export const fingerInkKey = "ios-finger-ink";

export function isIosApp() {
  return (
    isTauri() &&
    typeof window !== "undefined" &&
    window.__PDF_IOS_APP__ === true
  );
}
