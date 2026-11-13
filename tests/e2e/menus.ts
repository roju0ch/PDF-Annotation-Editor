import type { Page } from "@playwright/test";

export async function menu(page: Page, id: "view" | "tools" | "annotations") {
  const panel = page.locator(`#${id}-menu`);
  if (!(await panel.isVisible())) {
    const name = {
      view: "Ansicht und Navigation",
      tools: "Werkzeuge",
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
  await menu(page, "tools");
  await page.getByLabel("Werkzeug", { exact: true }).selectOption(value);
  if (text !== undefined)
    await page.getByLabel("Neuer Annotationstext").fill(text);
  await closeMenu(page);
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
