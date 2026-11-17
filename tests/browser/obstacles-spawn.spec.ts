import { test, expect, type Page } from "@playwright/test";

async function cellPoint(page: Page, x: number, y: number) {
  const canvas = page.locator("#world");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const width = Number(await canvas.getAttribute("width")) / 20;
  const height = Number(await canvas.getAttribute("height")) / 20;
  return { x: box.x + (x + 0.5) / width * box.width, y: box.y + (y + 0.5) / height * box.height };
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await cellPoint(page, ...from), b = await cellPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

test("furniture and start zones can be drawn, and the crowd resets into the zones", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#setup-map").selectOption("large");
  await page.locator("#setup-population").fill("200");
  await page.getByRole("button", { name: "Edit layout first" }).click();

  await page.getByRole("button", { name: "Place furniture" }).click();
  await drag(page, [30, 25], [33, 25]);
  await expect(page.locator("#editor-message")).toContainText("Furniture placed");

  await page.getByRole("button", { name: "Paint start zone" }).click();
  await drag(page, [6, 8], [10, 8]);
  // A small zone holds fewer than 200 people, so the crowd shrinks to fit and says so.
  await expect(page.locator("#editor-message")).toContainText("of the 200 people requested");
  const small = Number(await page.locator("#population").inputValue());
  expect(small).toBeLessThan(200);
  expect(small).toBeGreaterThan(0);

  // Painting more zone grows the crowd back toward the requested size.
  for (let y = 9; y <= 16; y++) await drag(page, [6, y], [20, y]);
  await expect(page.locator("#population")).toHaveValue("200");

  await page.getByRole("button", { name: "Undo edit" }).click();
  await expect(page.locator("#editor-message")).toContainText("undone");
  expect(errors).toEqual([]);
});
