import { test, expect } from "@playwright/test";

async function openStadium(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
}

test("2D and lazy 3D share one running simulation, selection, filters and camera state", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openStadium(page);
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("12");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("upper-east");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("4");
  await page.getByLabel("Inspect a spectator", { exact: true }).selectOption("0");
  await expect(page.locator("#stadium-person-context")).toBeVisible();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect.poll(async () => parseFloat(await page.locator("#stadium-run-time").innerText())).toBeGreaterThan(1);
  const before3d = parseFloat(await page.locator("#stadium-run-time").innerText());
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#stadium-3d-error-text")).toHaveText("");
  await expect(page.getByRole("button", { name: "Follow selected person", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("stadium-3d-overview.png"), fullPage: true });
  await page.getByRole("button", { name: "Follow selected person", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop following", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Connectors", exact: true }).click();
  await expect.poll(async () => parseFloat(await page.locator("#stadium-run-time").innerText())).toBeGreaterThan(before3d);
  await expect.poll(async () => Number((await page.locator("#stadium-3d-performance").getAttribute("data-fps")) ?? 0)).toBeGreaterThan(0);
  const count = await page.locator("#stadium-run-count").innerText();
  await page.getByRole("button", { name: "2D overview", exact: true }).click();
  await expect(page.locator("#stadium-map")).toBeVisible();
  await expect(page.locator("#stadium-run-count")).toHaveText(count);
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d canvas")).toBeVisible();
  await page.screenshot({ path: info.outputPath("stadium-3d-linked.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("3D initialization failure leaves the 2D simulator usable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, contextId: string, options?: unknown) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return original.call(this, contextId as never, options as never);
    } as typeof original;
  });
  await openStadium(page);
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d-error-text")).toContainText("3D view unavailable");
  await expect(page.getByRole("button", { name: "Return to 2D", exact: true })).toBeVisible();
  await expect(page.locator("#stadium-map")).toBeVisible();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Running");
});

test("follow camera returns to overview when the selected spectator evacuates", async ({ page }) => {
  await openStadium(page);
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("1");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("lower-bowl");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("8");
  await page.getByLabel("Inspect a spectator", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d canvas")).toBeVisible();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await page.getByRole("button", { name: "Follow selected person", exact: true }).click();
  await expect(page.locator("#stadium-run-status")).toHaveText("Evacuation complete", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "Follow selected person", exact: true })).toBeDisabled();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "overview");
  await expect(page.locator("#stadium-person-actual")).not.toHaveText("—");
});

test("connection isolation renders people from actual in-flight transfer state", async ({ page }, info) => {
  await openStadium(page);
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("20");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("upper-east");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("8");
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect.poll(async () => Number((await page.locator("#stadium-3d").getAttribute("data-visible-transfers")) ?? 0), { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.locator("#stadium-run-time").innerText();
  await page.waitForTimeout(250);
  await expect(page.locator("#stadium-run-time")).toHaveText(paused);
  await page.screenshot({ path: info.outputPath("stadium-3d-transfer-progress.png"), fullPage: true });
});
