import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/");
  await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
}
const elapsed = async (page: Page) => parseFloat(await page.locator("#stadium-run-time").innerText());

test("live stadium crowd keeps every level advancing and pauses for connection changes", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page);
  await expect(page.locator("#stadium-population")).toHaveValue("100");
  await expect(page.locator("#stadium-crowd-agents circle")).toHaveCount(100);
  const first = page.locator('#stadium-crowd-agents circle[data-person="0"]');
  const initial = await first.getAttribute("cx");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("8");
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Running");
  await expect(first).not.toHaveAttribute("cx", initial!);
  await expect(page.locator("#stadium-population")).toBeDisabled();
  await expect.poll(() => elapsed(page)).toBeGreaterThan(15);
  await expect.poll(async () => Number(await page.locator("#stadium-in-transit").innerText())).toBeGreaterThan(0);
  const before = await elapsed(page);
  await page.getByRole("button", { name: "200 level", exact: true }).click();
  await expect(page.locator('#stadium-crowd-agents circle[data-surface="lower-bowl"]:not([hidden])')).toHaveCount(0);
  await expect.poll(() => elapsed(page)).toBeGreaterThan(before + 2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.locator("#stadium-run-time").innerText();
  await page.waitForTimeout(250);
  await expect(page.locator("#stadium-run-time")).toHaveText(paused);
  // A single browser evaluation sees one consistent render of all disjoint counts.
  const total = await page.evaluate(() => Array.from(document.querySelectorAll("#stadium-level-counts strong"))
    .reduce((sum, el) => sum + Number(el.textContent), 0));
  expect(total).toBe(100);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: info.outputPath("stadium-live-crowd.png"), fullPage: true });
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await page.getByLabel("Inspect a section, gate or connection").selectOption("ramp-east");
  await page.getByRole("button", { name: "Close connection", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Paused");
  await expect(page.locator("#stadium-run-count")).toContainText("/ 100");
  await page.getByRole("button", { name: "Reset crowd", exact: true }).click();
  await expect(page.locator("#stadium-run-time")).toHaveText("0.0 s");
  await expect(page.locator("#stadium-run-count")).toHaveText("0 / 100");
  await expect(page.getByRole("button", { name: "Reopen connection", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator("#stadium-stranded").innerText())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("stadium completion, blocked runs, resume and navigation work on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByLabel("Spectators", { exact: true }).fill("1");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("lower-bowl");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("8");
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Evacuation complete", { timeout: 30000 });
  await expect(page.locator("#stadium-run-count")).toHaveText("1 / 1");
  await expect(page.locator("#stadium-crowd-agents circle:not([hidden])")).toHaveCount(0);
  await expect(page.locator("#stadium-mean-time")).not.toHaveText("—");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("upper-west");
  await page.getByLabel("Spectators", { exact: true }).fill("6");
  await page.getByLabel("Inspect a section, gate or connection").selectOption("ramp-west");
  await page.getByRole("button", { name: "Close connection", exact: true }).click();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toContainText("Blocked");
  await expect(page.locator("#stadium-stranded")).toHaveText("6");
  await page.getByRole("button", { name: "Reopen connection", exact: true }).click();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect.poll(() => elapsed(page)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  const paused = await page.locator("#stadium-run-time").innerText();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Paused");
  await expect(page.locator("#stadium-run-time")).toHaveText(paused);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("stadium-crowd-mobile.png"), fullPage: true });
});
