import type { Page } from "@playwright/test";

export async function zoomWithWheel(page: Page, ...deltas: number[]) {
  await page.keyboard.down("Control");
  try {
    for (const delta of deltas) await page.mouse.wheel(0, delta);
  } finally {
    await page.keyboard.up("Control");
  }
}
