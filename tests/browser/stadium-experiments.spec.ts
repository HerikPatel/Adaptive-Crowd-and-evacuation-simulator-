import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("adaptive controls and background comparisons produce charts and downloadable measurements", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
  const movement = page.getByLabel("Local movement", { exact: true });
  await expect(movement).toHaveValue("passing");
  await movement.selectOption("queue");
  await expect(page.locator("#stadium-movement-summary")).toContainText("Queue baseline: no overtaking");
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(movement).toBeDisabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await movement.selectOption("passing");
  await expect(page.locator("#stadium-movement-summary")).toContainText("Completed passes: 0; attempts: 0");
  await expect(page.getByLabel("Stadium routing", { exact: true })).toHaveValue("adaptive");
  await page.getByLabel("Stadium routing", { exact: true }).selectOption("free-flow");
  await expect(page.locator("#stadium-routing-summary")).toContainText("Free-flow baseline");
  await page.getByLabel("Stadium routing", { exact: true }).selectOption("adaptive");
  await page.getByLabel("Comparison populations", { exact: true }).fill("4");
  await expect(page.getByLabel("Comparison local movement", { exact: true })).toHaveValue("passing");
  await page.getByRole("button", { name: "Run comparisons", exact: true }).click();
  await expect(page.getByLabel("Comparison populations", { exact: true })).toBeDisabled();
  await expect(page.locator("#experiment-status")).toContainText("Comparison finished", { timeout: 60000 });
  await expect(page.locator("#experiment-table tr")).toHaveCount(8);
  await expect(page.locator("#experiment-bars .stadium-result-bar")).toHaveCount(8);
  await expect(page.locator("#experiment-statistics tr")).toHaveCount(4);
  await expect(page.locator("#experiment-statistics")).toContainText("one pair");
  await expect(page.locator("#experiment-chart polyline")).toHaveAttribute("points", /\d/);
  await page.getByLabel("Chart measure", { exact: true }).selectOption("waiting");
  await expect(page.locator("#experiment-chart title")).toContainText("Waiting people");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download results CSV", exact: true }).click();
  const download = await pending;
  const content = await readFile((await download.path())!, "utf8");
  expect(content.trim().split("\r\n")).toHaveLength(9);
  expect(content).toContain('"adaptive"'); expect(content).toContain('"free-flow"'); expect(content).toContain('"gate-east"');
  const resultRows = content.trim().split("\r\n").map(row => row.split(",").map(value => value.slice(1, -1)));
  for (const row of resultRows.slice(1)) {
    expect(row[resultRows[0].indexOf("movement_mode")]).toBe("passing");
    expect(row[resultRows[0].indexOf("model_version")]).toBe("stadium-movement-v2");
    expect(Number(row[resultRows[0].indexOf("completed_passes")])).toBeGreaterThanOrEqual(0);
  }
  const seriesPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download time series CSV", exact: true }).click();
  const series = await readFile((await (await seriesPending).path())!, "utf8");
  expect(series).toContain('"movement_mode"'); expect(series).toContain('"passing"');
  await page.locator("#stadium-experiments").screenshot({ path: info.outputPath("stadium-comparisons.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#experiment-chart").screenshot({ path: info.outputPath("stadium-comparison-mobile.png") });
  await page.getByLabel("Comparison populations", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Run comparisons", exact: true }).click();
  await page.getByRole("button", { name: "Cancel comparisons", exact: true }).click();
  await expect(page.locator("#experiment-status")).toContainText("Cancelled");
  await expect(page.getByLabel("Comparison populations", { exact: true })).toBeEnabled();
  await page.getByLabel("Comparison populations", { exact: true }).fill("2,2");
  await page.getByRole("button", { name: "Run comparisons", exact: true }).click();
  await expect(page.locator("#experiment-error")).toContainText("different");
  expect(errors).toEqual([]);
});

test("custom run limits reach the production worker and repeated-seed summaries export incomplete outcomes", async ({ page }) => {
  await page.goto("/"); await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
  await page.getByLabel("Comparison local movement", { exact: true }).selectOption("queue");
  await page.getByLabel("Comparison populations", { exact: true }).fill("4");
  await page.getByLabel("Comparison seeds", { exact: true }).fill("549,550,551");
  await page.getByLabel("Run limit (simulated seconds)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Run comparisons", exact: true }).click();
  await expect(page.getByLabel("Run limit (simulated seconds)", { exact: true })).toBeDisabled();
  await expect(page.locator("#experiment-status")).toContainText("24 runs recorded · 60 s limit", { timeout: 60000 });
  await expect(page.locator("#experiment-table tr")).toHaveCount(24);
  await expect(page.locator("#experiment-statistics tr")).toHaveCount(4);
  for (const row of await page.locator("#experiment-statistics tr").all()) {
    await expect(row).toContainText("Seeds: 549, 550, 551");
    await expect(row.locator("td").nth(0)).toHaveText("3 / 3");
    await expect(row).toContainText("60 s limit");
  }
  await expect(page.locator("#experiment-pairs")).toContainText("completion-time comparison unavailable");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download statistics CSV", exact: true }).click();
  const download = await pending;
  const csv = await readFile((await download.path())!, "utf8");
  const rows = csv.trim().split("\r\n").map(row => row.split(",").map(value => value.slice(1, -1)));
  expect(rows).toHaveLength(5);
  for (const row of rows.slice(1)) {
    expect(row[rows[0].indexOf("time_limit_seconds")]).toBe("60");
    expect(row[rows[0].indexOf("matched_pairs")]).toBe("3");
    expect(row[rows[0].indexOf("seeds")]).toBe("549;550;551");
    expect(row[rows[0].indexOf("movement_mode")]).toBe("queue");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Run limit (simulated seconds)", { exact: true }).fill("7201");
  expect(await page.getByLabel("Run limit (simulated seconds)", { exact: true }).evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
});
