import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  nativeSaveBridge as nativeAndroid,
  openAndEdit,
  state,
  saveButton,
  transferredPdf,
  savedName,
  comment,
  errorText,
  type TestWindow,
} from "./nativeSaveHarness";

test("Android save acknowledges the real worker export only after native storage confirmation", async ({
  page,
  browserName,
}) => {
  await nativeAndroid(page, "hold");
  await openAndEdit(page);
  const original = await readFile("artifacts/fixture.pdf");
  await saveButton(page).click();
  await expect.poll(async () => (await state(page)).pendingFinish).toBe(true);
  await expect(saveButton(page)).toBeDisabled();
  expect(await state(page)).toMatchObject({
    acknowledgements: 0,
    workerDirty: true,
    browserDownloads: 0,
  });
  await expect(page.getByText(/^PDF gespeichert:/)).toHaveCount(0);
  const file = await transferredPdf(page, browserName, "confirmed");
  await page.evaluate(() => {
    const release = (globalThis as TestWindow).nativeSaveTest.release;
    if (!release) throw Error("Expected a pending native save");
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

test("cancelling the Android picker leaves annotations unsaved and permits a later confirmed save", async ({
  page,
  browserName,
}) => {
  await nativeAndroid(page, "cancelled");
  await openAndEdit(page);
  await saveButton(page).click();
  await expect(page.getByRole("status")).toContainText(
    "Speichern abgebrochen. Änderungen bleiben ungesichert.",
  );
  await expect(saveButton(page)).toBeEnabled();
  expect(await state(page)).toMatchObject({
    acknowledgements: 0,
    workerDirty: true,
    browserDownloads: 0,
  });
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await page.evaluate(() => {
    (globalThis as TestWindow).nativeSaveTest.mode = "saved";
  });
  await saveButton(page).click();
  await expect(page.getByRole("status")).toContainText(
    "PDF gespeichert: " + savedName,
  );
  const value = await state(page);
  expect(value.transactions).toHaveLength(2);
  expect(value.acknowledgements).toBe(1);
  expect(value.workerDirty).toBe(false);
  expect(value.browserDownloads).toBe(0);
  await transferredPdf(page, browserName, "after-cancel");
});

test("Android write failure keeps changes unsaved, aborts the transfer and never falls back to a browser download", async ({
  page,
  browserName,
}) => {
  await nativeAndroid(page, "failure");
  await openAndEdit(page);
  await saveButton(page).click();
  await expect(page.getByRole("alert")).toContainText(errorText);
  await expect(saveButton(page)).toBeEnabled();
  const failed = await state(page);
  expect(failed).toMatchObject({
    acknowledgements: 0,
    workerDirty: true,
    browserDownloads: 0,
  });
  expect(failed.calls).toContain("plugin:android-bridge|abort_pdf_save");
  await expect(page.getByText(/^PDF gespeichert:/)).toHaveCount(0);
  await page.evaluate(() => {
    (globalThis as TestWindow).nativeSaveTest.mode = "saved";
  });
  await saveButton(page).click();
  await expect(page.getByRole("status")).toContainText(
    "PDF gespeichert: " + savedName,
  );
  const value = await state(page);
  expect(value.transactions).toHaveLength(2);
  expect(value.acknowledgements).toBe(1);
  expect(value.workerDirty).toBe(false);
  expect(value.browserDownloads).toBe(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await transferredPdf(page, browserName, "after-failure");
});

test("a confirmed Android file stays saved when the subsequent worker acknowledgement fails", async ({
  page,
  browserName,
}) => {
  await nativeAndroid(page, "saved");
  await openAndEdit(page);
  await page.evaluate(() => {
    (globalThis as TestWindow).nativeSaveTest.failAcknowledgement = true;
  });
  await saveButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Die PDF wurde gespeichert, aber die App konnte den Bearbeitungsstatus nicht aktualisieren. Bitte die gespeicherte Datei öffnen und prüfen.",
  );
  await expect(page.getByRole("status")).toContainText(
    "PDF gespeichert: " + savedName,
  );
  await expect(saveButton(page)).toBeEnabled();
  const value = await state(page);
  expect(value).toMatchObject({
    acknowledgements: 1,
    workerDirty: true,
    browserDownloads: 0,
  });
  expect(value.transactions).toHaveLength(1);
  expect(
    value.calls.filter((command) => command.endsWith("|finish_pdf_save")),
  ).toHaveLength(1);
  expect(value.calls).not.toContain("plugin:android-bridge|abort_pdf_save");
  await transferredPdf(page, browserName, "saved-with-ack-error");
});
