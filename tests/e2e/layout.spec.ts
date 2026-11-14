import { test, expect } from "@playwright/test";
import { menu, closeMenu, tool } from "./menus";
const browserSuffix =
  process.env.PLAYWRIGHT_BROWSER === "firefox" ? "-firefox" : "";

for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test(`compact workspace ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("");
    await page
      .getByLabel("PDF öffnen", { exact: true })
      .setInputFiles("artifacts/fixture.pdf");
    await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    const viewport = page.getByTestId("viewport");
    const before = (await viewport.boundingBox())!;
    expect(before.height / size.height).toBeGreaterThan(0.8);
    expect(before.width).toBe(size.width);
    expect(
      await page
        .locator("header")
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(size.width <= 720 ? 86 : 48);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(size.width);
    for (const id of ["view", "tools", "annotations"] as const) {
      await expect(page.locator(`#${id}-menu`)).toBeHidden();
    }
    await expect(page.getByLabel("Werkzeug", { exact: true })).toHaveCount(0);
    const tools = page.getByRole("toolbar", { name: "Annotationswerkzeuge" });
    await expect(tools.getByRole("button")).toHaveCount(7);
    const buttons = await tools.getByRole("button").all();
    for (const button of buttons) {
      const bounds = (await button.boundingBox())!;
      // Firefox DOMRect can report 35.9999847 for a CSS width of 36px.
      // Allow only subpixel representation error, not a smaller touch target.
      expect(bounds.width).toBeGreaterThanOrEqual(36 - 0.01);
      expect(bounds.height).toBeGreaterThanOrEqual(36 - 0.01);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    }
    const toolsBox = (await tools.boundingBox())!;
    const actions = (await page.locator(".document-actions").boundingBox())!;
    if (size.width <= 720)
      expect(toolsBox.y).toBeGreaterThanOrEqual(actions.y + actions.height);
    else expect(toolsBox.y).toBe(actions.y);
    const transform = await page.getByTestId("world").getAttribute("style");
    await menu(page, "annotations");
    await expect(page.locator(".annotation-list button")).toBeVisible();
    expect(await viewport.boundingBox()).toEqual(before);
    expect(await page.getByTestId("world").getAttribute("style")).toBe(
      transform,
    );
    await page.locator(".annotation-list button").click();
    await page
      .getByLabel("Annotationsinhalt", { exact: true })
      .fill("Entwurf bleibt beim Schließen erhalten");
    await closeMenu(page);
    await menu(page, "annotations");
    await expect(
      page.getByLabel("Annotationsinhalt", { exact: true }),
    ).toHaveValue("Entwurf bleibt beim Schließen erhalten");
    await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#annotations-menu")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Annotationen anzeigen" }),
    ).toBeFocused();

    await tool(page, "Ink");
    await expect(
      page.getByRole("button", { name: "Freihand", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await menu(page, "tools");
    await expect(
      page.getByLabel("Strichbreite", { exact: true }),
    ).toBeVisible();
    await menu(page, "view");
    await expect(page.locator("#tools-menu")).toBeHidden();
    const panel = (await page.locator("#view-menu").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(size.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(size.height);
    await page.getByRole("button", { name: "Breite", exact: true }).click();
    await closeMenu(page);
    await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    // Width-fit gives the plan the full screen width on a portrait phone.
    await page.screenshot({
      path: `artifacts/compact-${size.width}x${size.height}${browserSuffix}.png`,
    });
    await menu(page, "annotations");
    await page.screenshot({
      path: `artifacts/compact-menu-${size.width}x${size.height}${browserSuffix}.png`,
    });
  });
}

test("dismissing a menu on the PDF does not place a note", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await tool(page, "Text", "Absichtlich platzierte Notiz");
  await menu(page, "tools");
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  const point = {
    x: sheet.x + sheet.width * 0.4,
    y: sheet.y + sheet.height * 0.8,
  };
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#tools-menu")).toBeHidden();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
});

test("direct icons switch tools with keyboard hints and preserve pending properties", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  const tools = page.getByRole("toolbar", { name: "Annotationswerkzeuge" });
  await expect(
    tools.getByRole("button", { name: "Freihand", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  const select = tools.getByRole("button", {
    name: "Auswählen / Verschieben",
    exact: true,
  });
  await expect(select).toBeEnabled();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await select.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Auswählen / Verschieben");
  const hint = (await page.getByRole("tooltip").boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(8);
  expect(hint.x + hint.width).toBeLessThanOrEqual(382);
  await page.mouse.move(1, 200);
  await select.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tools.getByRole("button", { name: "Freihand", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText("Freihand");
  await page.keyboard.press("Space");
  await expect(
    tools.getByRole("button", { name: "Freihand", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".compact-menu:popover-open")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toHaveText("Notiz");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await menu(page, "tools");
  await expect(page.getByLabel("Neuer Annotationstext")).toBeVisible();
  await expect(page.getByLabel("Strichbreite", { exact: true })).toHaveCount(0);
  await tools
    .getByRole("button", { name: "Ink-Teilradierer (Klick)", exact: true })
    .click();
  await expect(page.locator("#tools-menu")).toBeHidden();
  await menu(page, "tools");
  await expect(page.getByLabel("Radierer-Radius")).toBeVisible();
  await closeMenu(page);
  await menu(page, "annotations");
  await page.locator(".annotation-list button").first().click();
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Ungesicherter Kommentar");
  await closeMenu(page);
  for (const button of await tools.getByRole("button").all())
    await expect(button).toBeDisabled();
  await menu(page, "annotations");
  await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
  await closeMenu(page);
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
});
