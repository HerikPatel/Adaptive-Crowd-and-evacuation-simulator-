import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function clickCell(page: Page, x: number, y: number) {
  const canvas = page.locator("#world");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const width = Number(await canvas.getAttribute("width")) / 20;
  const height = Number(await canvas.getAttribute("height")) / 20;
  await page.mouse.click(box.x + (x + 0.5) / width * box.width, box.y + (y + 0.5) / height * box.height);
}

test("a saved layout downloads, and loading it restores the edit on another map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#setup-map").selectOption("mvp");
  await page.locator("#setup-population").fill("60");
  await page.getByRole("button", { name: "Edit layout first" }).click();

  await page.getByRole("button", { name: "Draw wall" }).click();
  await clickCell(page, 27, 9);
  await expect(page.locator("#layout-state")).toContainText("Edited layout");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save layout" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("evacuation-lab-mvp-layout.json");
  const saved = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(saved).cells[9][27]).toBe("#");

  // Switch to another map, then load the file: the app returns to the saved map and edit.
  await page.locator("#map").selectOption("large");
  await expect(page.locator("#layout-state")).toContainText("Original layout");
  await page.locator("#layout-file").setInputFiles({ name: "my-layout.json", mimeType: "application/json", buffer: Buffer.from(saved) });
  await expect(page.locator("#editor-message")).toContainText("Loaded my-layout.json");
  await expect(page.locator("#map")).toHaveValue("mvp");
  await expect(page.locator("#layout-state")).toContainText("Edited layout");

  await page.locator("#layout-file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{oops") });
  await expect(page.locator("#editor-message")).toContainText("not valid JSON");
  await expect(page.locator("#editor-message")).toHaveClass(/error/);
  expect(errors).toEqual([]);
});
