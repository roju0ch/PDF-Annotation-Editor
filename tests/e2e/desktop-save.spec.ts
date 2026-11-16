import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  nativeSaveBridge,
  openAndEdit,
  state,
  saveButton,
  transferredPdf,
  savedName,
  comment,
  errorText,
  type TestWindow,
} from "./nativeSaveHarness";

// Platform IPC is simulated, not the PDF engine. Rust tests exercise the
// native file writer separately; these cases verify routing and editor state.
for (const platform of ["windows", "macos", "linux"] as const) {
  test(`${platform} app saves native PDF bytes only after desktop storage confirmation`, async ({
    page,
    browserName,
  }) => {
    await nativeSaveBridge(page, "hold", platform);
    await openAndEdit(page);
    const original = await readFile("artifacts/fixture.pdf");
    if (platform === "macos") await page.keyboard.press("Meta+s");
    else if (platform === "windows") await page.keyboard.press("Control+s");
    else await saveButton(page).click();
    await expect.poll(async () => (await state(page)).pendingFinish).toBe(true);
    await expect(saveButton(page)).toBeDisabled();
    const pending = await state(page);
    expect(pending).toMatchObject({
      acknowledgements: 0,
      workerDirty: true,
      browserDownloads: 0,
    });
    expect(pending.calls[0]).toBe("plugin:desktop-save|begin_pdf_save");
    expect(pending.calls.at(-1)).toBe("plugin:desktop-save|finish_pdf_save");
    expect(pending.calls.length).toBeGreaterThan(2);
    expect(
      pending.calls
        .slice(1, -1)
        .every((command) => command === "plugin:desktop-save|append_pdf_save"),
    ).toBe(true);
    expect(pending.transactions).toHaveLength(1);
    await expect(page.getByText(/^PDF gespeichert:/)).toHaveCount(0);
    const file = await transferredPdf(
      page,
      browserName,
      `${platform}-confirmed`,
    );
    await page.evaluate(() => {
      const release = (globalThis as TestWindow).nativeSaveTest.release;
      if (!release) throw Error("Expected a pending native desktop save");
      release("saved");
    });
    await expect(page.getByRole("status")).toContainText(
      "PDF gespeichert: " + savedName,
    );
    await expect(saveButton(page)).toBeEnabled();
    await expect.poll(async () => (await state(page)).workerDirty).toBe(false);
    expect(await state(page)).toMatchObject({
      acknowledgements: 1,
      browserDownloads: 0,
    });
    await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(file);
    await expect(page.locator(".annotation-list")).toContainText(comment);
    expect(await readFile("artifacts/fixture.pdf")).toEqual(original);
  });
}

for (const outcome of ["cancelled", "failure"] as const) {
  test(`Windows native ${outcome} leaves changes unsaved and permits a confirmed retry`, async ({
    page,
    browserName,
  }) => {
    await nativeSaveBridge(page, outcome, "windows");
    await openAndEdit(page);
    await saveButton(page).click();
    if (outcome === "cancelled")
      await expect(page.getByRole("status")).toContainText(
        "Speichern abgebrochen. Änderungen bleiben ungesichert.",
      );
    else await expect(page.getByRole("alert")).toContainText(errorText);
    await expect(saveButton(page)).toBeEnabled();
    const failed = await state(page);
    expect(failed).toMatchObject({
      acknowledgements: 0,
      workerDirty: true,
      browserDownloads: 0,
    });
    expect(
      failed.calls.every((command) =>
        command.startsWith("plugin:desktop-save|"),
      ),
    ).toBe(true);
    if (outcome === "failure")
      expect(failed.calls).toContain("plugin:desktop-save|abort_pdf_save");
    else
      expect(failed.calls).not.toContain("plugin:desktop-save|abort_pdf_save");
    await expect(page.getByText(/^PDF gespeichert:/)).toHaveCount(0);
    await expect(page.locator(".annotation-list button")).toHaveCount(2);
    await page.evaluate(() => {
      (globalThis as TestWindow).nativeSaveTest.mode = "saved";
    });
    await saveButton(page).click();
    await expect(page.getByRole("status")).toContainText(
      "PDF gespeichert: " + savedName,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const saved = await state(page);
    expect(saved.transactions).toHaveLength(2);
    expect(saved).toMatchObject({
      acknowledgements: 1,
      workerDirty: false,
      browserDownloads: 0,
    });
    await transferredPdf(page, browserName, `windows-after-${outcome}`);
  });
}
