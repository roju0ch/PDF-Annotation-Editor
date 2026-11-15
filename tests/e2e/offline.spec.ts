import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import * as mupdf from "mupdf";
import { tool } from "./menus";

test("cold start with network disabled loads bundled worker/WASM and edits/exports a local PDF", async ({
  browser,
  browserName,
}) => {
  const context = await browser.newContext({ offline: true });
  const files = new Set<string>(),
    external: string[] = [];
  const root = resolve("dist");
  // Tauri serves frontendDist from local embedded assets. This harness supplies
  // those exact build files while the browser's actual network is disabled.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4173") {
      external.push(url.origin);
      await route.abort();
      return;
    }
    const relative =
      decodeURIComponent(url.pathname).replace(
        /^\/PDF-Annotation-Editor\//,
        "",
      ) || "index.html";
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) {
      await route.abort();
      return;
    }
    try {
      const body = await readFile(path);
      files.add(relative);
      const contentType =
        (
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".wasm": "application/wasm",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(path)] || "application/octet-stream";
      await route.fulfill({ status: 200, body, contentType });
    } catch {
      await route.abort();
    }
  });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/PDF-Annotation-Editor/");
    await page
      .getByLabel("PDF öffnen", { exact: true })
      .setInputFiles("artifacts/fixture.pdf");
    await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await tool(page, "Text", "Offline annotation");
    const b = (await page.getByTestId("page-0").boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.5);
    await expect(page.locator(".annotation-list")).toContainText(
      "Offline annotation",
    );
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "PDF herunterladen", exact: true })
      .click();
    const file = `artifacts/offline-${browserName}.pdf`;
    await (await pending).saveAs(file);
    const pdf = new mupdf.PDFDocument(new Uint8Array(await readFile(file))),
      p = pdf.loadPage(0);
    try {
      expect(
        p
          .getAnnotations()
          .some((a) => a.getContents() === "Offline annotation"),
      ).toBe(true);
      expect(pdf.wasRepaired()).toBe(false);
    } finally {
      p.destroy();
      pdf.destroy();
    }
    expect(external).toEqual([]);
    expect([...files].some((p) => p.endsWith(".wasm"))).toBe(true);
    expect(
      [...files].some((p) => p.includes("pdf.worker") && p.endsWith(".js")),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
