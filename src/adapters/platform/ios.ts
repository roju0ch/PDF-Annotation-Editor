import { isTauri } from "@tauri-apps/api/core";

declare global {
  interface Window {
    readonly __PDF_IOS_APP__?: boolean;
  }
}

const fingerInkKey = "ios-finger-ink";

export function readFingerInkPreference() {
  try {
    return localStorage.getItem(fingerInkKey) === "true";
  } catch {
    return false;
  }
}

export function writeFingerInkPreference(enabled: boolean) {
  try {
    localStorage.setItem(fingerInkKey, String(enabled));
  } catch {
    // WKWebView may restrict persistent storage. The choice still applies to this session.
  }
}

export function isIosApp() {
  return (
    isTauri() &&
    typeof window !== "undefined" &&
    window.__PDF_IOS_APP__ === true
  );
}
