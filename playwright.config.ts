import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    browserName:
      process.env.PLAYWRIGHT_BROWSER === "firefox" ? "firefox" : "chromium",
    baseURL: "http://127.0.0.1:4173/PDF-Annotation-Editor/",
    viewport: { width: 1440, height: 900 },
    launchOptions:
      process.env.CHROMIUM_PATH && process.env.PLAYWRIGHT_BROWSER !== "firefox"
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {},
  },
  webServer: {
    command:
      "npm run build && npm run preview -- --port 4173 --base /PDF-Annotation-Editor/",
    url: "http://127.0.0.1:4173/PDF-Annotation-Editor/",
    reuseExistingServer: false,
  },
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
});
