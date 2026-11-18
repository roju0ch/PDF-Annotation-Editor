import { expect, type Locator, type Page } from "@playwright/test";

export const documentSwitchDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Ungesicherte Änderungen", exact: true });

export async function respondToDocumentSwitch(
  page: Page,
  accept: boolean,
  activate?: (button: Locator) => Promise<unknown>,
) {
  const dialog = documentSwitchDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Ungesicherte Änderungen verwerfen und eine andere PDF öffnen?",
  );
  await expect(
    dialog.getByRole("button", { name: "Abbrechen", exact: true }),
  ).toBeFocused();
  const button = dialog.getByRole("button", {
    name: accept ? "Verwerfen und öffnen" : "Abbrechen",
    exact: true,
  });
  if (activate) await activate(button);
  else await button.click();
  await expect(dialog).not.toBeVisible();
}
