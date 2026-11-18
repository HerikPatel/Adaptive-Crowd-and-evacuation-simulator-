import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a building comparison runs in the background, shows results side by side and exports CSV", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#setup-map").selectOption("mvp");
  await page.locator("#setup-population").fill("80");
  await page.getByRole("button", { name: "Edit layout first" }).click();

  await page.locator(".comparison-panel summary").click();
  // Shortest + Congestion × A* + Theta* by default; add the flow field for 5 runs.
  await page.getByLabel("Shared Flow Field").check();
  await expect(page.locator("#comparison-summary")).toContainText("5 runs · 80 people · Original bottleneck");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(page.locator("#comparison-status")).toContainText("Comparison finished · 5 runs", { timeout: 100_000 });
  await expect(page.locator("#comparison-bars .stadium-result-bar")).toHaveCount(5);
  await expect(page.locator("#comparison-bars i.best")).toHaveCount(1);
  await expect(page.locator("#comparison-table tr")).toHaveCount(5);
  await expect(page.locator("#comparison-table")).toContainText("80/80");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download results CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("evacuation-lab-mvp-comparison.csv");
  const csv = (await readFile((await download.path())!, "utf8")).trim().split("\n");
  expect(csv).toHaveLength(6);
  expect(csv[0]).toContain("routing_strategy,algorithm");
  expect(errors).toEqual([]);
});

test("choosing nothing explains what to pick instead of running", async ({ page }) => {
  await page.goto("/");
  await page.locator("#setup-map").selectOption("mvp");
  await page.getByRole("button", { name: "Edit layout first" }).click();
  await page.locator(".comparison-panel summary").click();
  for (const name of ["Shortest Path", "Congestion Aware"]) await page.getByLabel(name, { exact: true }).uncheck();
  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(page.locator("#comparison-error")).toContainText("at least one");
});
