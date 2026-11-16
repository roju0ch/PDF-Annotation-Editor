/** Actual CSS insets only. Android already subtracts native host insets from
 * the WebView viewport and consumes them before dispatching to the WebView. */
export function safeViewport() {
  const main = document.querySelector("main");
  const padding = main ? getComputedStyle(main) : null;
  const pixels = (value?: string) => Number.parseFloat(value || "0") || 0;
  return {
    left: pixels(padding?.paddingLeft),
    top: pixels(padding?.paddingTop),
    right: window.innerWidth - pixels(padding?.paddingRight),
    bottom: window.innerHeight - pixels(padding?.paddingBottom),
  };
}
