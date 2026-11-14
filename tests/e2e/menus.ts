import type { Page } from "@playwright/test";

export async function menu(page: Page, id: "view" | "tools" | "annotations") {
  const panel = page.locator(`#${id}-menu`);
  if (!(await panel.isVisible())) {
    const name = {
      view: "Ansicht und Navigation",
      tools: "Werkzeugeigenschaften",
      annotations: "Annotationen anzeigen",
    }[id];
    await page.getByRole("button", { name, exact: true }).click();
  }
}
export async function closeMenu(page: Page) {
  const close = page.getByRole("button", {
    name: "Menü schließen",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
}
export async function tool(page: Page, value: string, text?: string) {
  const names: Record<string, string> = {
    select: "Auswählen / Verschieben",
    Ink: "Freihand",
    Text: "Notiz",
    FreeText: "Textfeld",
    erase: "Ink-Teilradierer (Klick)",
  };
  await page.getByRole("button", { name: names[value], exact: true }).click();
  if (text !== undefined) {
    await menu(page, "tools");
    await page.getByLabel("Neuer Annotationstext").fill(text);
    await closeMenu(page);
  }
}
export async function viewAction(page: Page, name: string) {
  await menu(page, "view");
  await page.getByRole("button", { name, exact: true }).click();
  await closeMenu(page);
}
export async function viewOption(page: Page, name: string, value: string) {
  await menu(page, "view");
  await page.getByLabel(name, { exact: true }).selectOption(value);
  await closeMenu(page);
}
