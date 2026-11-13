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
    ).toBeLessThanOrEqual(48);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(size.width);
    for (const id of ["view", "tools", "annotations"] as const) {
      await expect(page.locator(`#${id}-menu`)).toBeHidden();
    }
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
      page.getByRole("button", { name: "Werkzeuge", exact: true }),
    ).toContainText("Freihand");
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
