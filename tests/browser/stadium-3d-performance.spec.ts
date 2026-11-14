import { test, expect } from "@playwright/test";

test("records separate 3D rendering measurements for 100 and 1000 spectators", async ({ page }, info) => {
  test.slow();
  await page.goto("/");
  await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Crowd behavior", { exact: true }).selectOption("uniform");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Architectural 3D", exact: true }).click();
  await expect(page.locator("#stadium-3d canvas")).toBeVisible({ timeout: 30000 });
  const results: Record<string, { renderFps: number; renderMs: number; simulationTime: number }> = {};
  for (const count of [100, 1000]) {
    await page.getByLabel("Spectators", { exact: true }).fill(String(count));
    await page.locator("#stadium-3d-performance").evaluate(element => {
      delete (element as HTMLElement).dataset.fps; delete (element as HTMLElement).dataset.renderMs;
    });
    await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
    await expect.poll(async () => Number((await page.locator("#stadium-3d-performance").getAttribute("data-fps")) ?? 0), { timeout: 30000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    results[count] = {
      renderFps: Number(await page.locator("#stadium-3d-performance").getAttribute("data-fps")),
      renderMs: Number(await page.locator("#stadium-3d-performance").getAttribute("data-render-ms")),
      simulationTime: parseFloat(await page.locator("#stadium-run-time").innerText()),
    };
    expect(results[count].renderFps).toBeGreaterThan(0);
    expect(results[count].renderMs).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Reset crowd", exact: true }).click();
  }
  console.log(`STADIUM_3D_BENCHMARK ${JSON.stringify({ project: info.project.name, results })}`);
});
