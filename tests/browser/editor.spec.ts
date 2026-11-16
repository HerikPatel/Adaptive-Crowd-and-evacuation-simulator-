import { test, expect, type Page } from "@playwright/test";

async function cellPoint(page: Page, x: number, y: number) {
  const canvas = page.locator("#world");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const width = Number(await canvas.getAttribute("width")) / 20;
  const height = Number(await canvas.getAttribute("height")) / 20;
  return { x: box.x + (x + 0.5) / width * box.width, y: box.y + (y + 0.5) / height * box.height };
}
async function clickCell(page: Page, x: number, y: number) {
  const point = await cellPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}
async function pixel(page: Page, x: number, y: number) {
  return page.locator("#world").evaluate((element, p) => {
    const ctx = (element as HTMLCanvasElement).getContext("2d")!;
    return Array.from(ctx.getImageData(p.x * 20 + 3, p.y * 20 + 3, 1, 1).data).slice(0, 3);
  }, { x, y });
}

test("custom size, draw/erase/undo, multiple exits, and reset work on a scaled canvas", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#setup-map").selectOption("mvp");
  await page.locator("#setup-population").fill("137");
  await page.getByRole("button", { name: "Edit layout first" }).click();
  await expect(page.locator("#map")).toHaveValue("mvp");
  await expect(page.locator("#status")).toHaveText("Ready");
  await expect(page.locator("#metric-remaining")).toHaveText("137");
  await page.getByRole("button", { name: "Draw wall", exact: true }).click();
  const from = await cellPoint(page, 20, 13), to = await cellPoint(page, 22, 13);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#editor-message")).toContainText("Layout updated");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  for (const x of [20, 21, 22]) await expect.poll(() => pixel(page, x, 13)).toEqual([16, 28, 43]);
  await page.getByRole("button", { name: "Erase wall", exact: true }).click();
  await clickCell(page, 21, 13);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect.poll(() => pixel(page, 21, 13)).toEqual([38, 55, 72]);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(() => pixel(page, 21, 13)).toEqual([16, 28, 43]);

  // The same coordinate conversion must work after the viewport shrinks.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add exit", exact: true }).click();
  await clickCell(page, 3, 4);
  await expect(page.locator("#layout-state")).toHaveText("Edited layout · 3 exits");
  await clickCell(page, 16, 4);
  await expect(page.locator("#layout-state")).toHaveText("Edited layout · 4 exits");
  await expect(page.locator("#metric-exitC")).toHaveText("0");
  await expect(page.locator("#metric-exitD")).toHaveText("0");
  await page.locator("#editor-exit").selectOption("C");
  await clickCell(page, 4, 4);
  await expect(page.locator("#editor-message")).toContainText("Exit C added or widened");
  await page.getByRole("button", { name: "Block Exit C", exact: true }).click();
  await expect(page.getByRole("button", { name: "Re-open Exit C", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Block Exit C", exact: true })).toBeVisible();
  await expect(page.locator("#layout-state")).toContainText("4 exits");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect.poll(() => pixel(page, 21, 13)).toEqual([16, 28, 43]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("editor-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Restore original layout", exact: true }).click();
  await expect(page.locator("#layout-state")).toHaveText("Original layout · 2 exits");
  await expect(page.locator("#metric-exitC")).toHaveCount(0);
  await expect.poll(() => pixel(page, 21, 13)).toEqual([38, 55, 72]);
  expect(errors).toEqual([]);
});

test("invalid sizes and edits leave the run intact; custom exit totals appear in results", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#setup-map").selectOption("mvp");
  await page.locator("#setup-population").fill("0");
  await page.getByRole("button", { name: "Edit layout first" }).click();
  await expect(page.locator("#menu-screen")).toBeVisible();
  await page.locator("#setup-population").fill("37");
  await page.getByRole("button", { name: "Edit layout first" }).click();
  await page.getByRole("button", { name: "Draw wall", exact: true }).click();
  await clickCell(page, 0, 10);
  await expect(page.locator("#editor-message")).toContainText("outer boundary");
  await expect(page.locator("#layout-state")).toContainText("Original");
  await page.getByRole("button", { name: "Add exit", exact: true }).click();
  await clickCell(page, 3, 4);
  await page.locator("#population").fill("42");
  await page.getByRole("button", { name: "Apply crowd size", exact: true }).click();
  await expect(page.locator("#metric-remaining")).toHaveText("42");
  await expect(page.locator("#layout-state")).toContainText("3 exits");
  await page.locator("#population").fill("1001");
  await page.getByRole("button", { name: "Apply crowd size", exact: true }).click();
  await expect(page.locator("#metric-remaining")).toHaveText("42");
  await page.locator("#population").fill("42");
  await page.getByRole("button", { name: "Block Exit A", exact: true }).click();
  await page.getByRole("button", { name: "Block Exit B", exact: true }).click();
  await page.getByRole("button", { name: "Block Exit C", exact: true }).click();
  await expect(page.locator("#exit-message")).toContainText("at least one exit");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("#results-screen")).toBeVisible({ timeout: 65000 });
  await expect(page.locator("#result-exitC")).toHaveText("42");
  await expect(page.locator("#result-exitA")).toHaveText("0");
  await expect(page.locator("#result-exitB")).toHaveText("0");
  await expect(page.locator("#result-clearC")).not.toHaveText("Unused");
  await expect(page.locator("#result-context")).toContainText("3 exits");
  await page.screenshot({ path: info.outputPath("custom-exit-results.png"), fullPage: true });
  expect(errors).toEqual([]);
});
