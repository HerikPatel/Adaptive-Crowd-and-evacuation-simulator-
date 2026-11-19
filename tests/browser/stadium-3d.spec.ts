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
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-model", "shi-stadium-inspired");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-crowd-style", "destination-dots");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-lighting", "day");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-cutaway", "true");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "reset");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-visible-routes", "1");
  await expect(page.locator(".stadium-3d-hud")).toContainText("Outside 0/12");
  const follow = page.getByRole("button", { name: "Follow selected person", exact: true });
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "person-follow");
  await page.locator("#stadium-3d canvas").hover();
  await page.mouse.wheel(0, -120);
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "free");
  await page.getByRole("button", { name: "Top-down", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "top-down");
  await page.screenshot({ path: info.outputPath("stadium-3d-top-down.png"), fullPage: true });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "reset");
  await page.getByRole("button", { name: "Stadium lights", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-lighting", "night");
  await expect(page.getByRole("button", { name: "Stadium lights", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("stadium-3d-night.png"), fullPage: true });
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-lighting", "day");
  await expect(follow).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("stadium-3d-overview.png"), fullPage: true });
  await page.getByRole("button", { name: "Full architecture", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-cutaway", "false");
  await page.screenshot({ path: info.outputPath("stadium-3d-full-architecture.png"), fullPage: true });
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
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-cutaway", "false");
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "connections");
  await page.screenshot({ path: info.outputPath("stadium-3d-linked.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("manual crowd preset loads seated spectators without starting the run", async ({ page }) => {
  await openStadium(page);
  await page.getByRole("button", { name: "Load 1,000 spectators" }).click();
  await expect(page.getByLabel("Spectators", { exact: true })).toHaveValue("1000");
  await expect(page.getByLabel("Starting seats", { exact: true })).toHaveValue("all");
  await expect(page.locator("#stadium-run-status")).toHaveText("Ready");
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator(".stadium-3d-hud")).toContainText("Seated 1000");
});

test("free camera explores from the current view and presets restore orbit controls", async ({ page }) => {
  await openStadium(page);
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  const view = page.locator("#stadium-3d");
  const canvas = view.locator("canvas");
  await page.getByRole("button", { name: "Free camera", exact: true }).click();
  await expect(view).toHaveAttribute("data-camera-mode", "fly");
  await expect(page.locator("#stadium-3d-fly-help")).toBeVisible();
  await canvas.press("KeyW");
  await page.getByRole("button", { name: "Top-down", exact: true }).click();
  await expect(view).toHaveAttribute("data-camera-mode", "orbit");
  await expect(view).toHaveAttribute("data-camera", "top-down");
  await expect(page.locator("#stadium-3d-fly-help")).toBeHidden();
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

test("follow camera stops without resetting the viewpoint when the selected spectator evacuates", async ({ page }) => {
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
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "person-follow");
  await expect(page.locator("#stadium-run-status")).toHaveText("Evacuation complete", { timeout: 30000 });
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-camera", "free");
  await expect(page.getByLabel("Inspect a spectator", { exact: true })).toHaveValue("");
});

test("connection isolation renders people from actual in-flight transfer state", async ({ page }, info) => {
  await openStadium(page);
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("20");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("upper-east");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("8");
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d")).toHaveAttribute("data-visible-routes", "0");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect.poll(async () => Number((await page.locator("#stadium-3d").getAttribute("data-visible-transfers")) ?? 0), { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.locator("#stadium-run-time").innerText();
  await page.waitForTimeout(250);
  await expect(page.locator("#stadium-run-time")).toHaveText(paused);
  await page.screenshot({ path: info.outputPath("stadium-3d-transfer-progress.png"), fullPage: true });
});
