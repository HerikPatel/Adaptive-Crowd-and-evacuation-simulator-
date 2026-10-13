import { test, expect } from "@playwright/test";
test("controls, pause, dynamic closure, completion and reset", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#metric-remaining")).toHaveText("100");
  const initial = await page
    .locator("canvas")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(async () =>
      parseFloat(await page.locator("#metric-elapsed").innerText()),
    )
    .toBeGreaterThanOrEqual(5);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Paused");
  const paused = await page.locator("#metric-elapsed").innerText();
  await page.waitForTimeout(300);
  await expect(page.locator("#metric-elapsed")).toHaveText(paused);
  await page.getByRole("button", { name: "Block Exit A", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Re-open Exit A" }),
  ).toBeVisible();
  await page.getByLabel("Show paths", { exact: true }).check();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator("#metric-switches").innerText()),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("rerouting.png"),
    fullPage: true,
  });
  await expect(page.locator("#status")).toHaveText("Complete", {
    timeout: 65000,
  });
  await expect(page.locator("#metric-remaining")).toHaveText("0");
  await expect(page.locator("#metric-exitB")).toHaveText("100");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByLabel("Show paths", { exact: true }).uncheck();
  await expect(page.locator("#status")).toHaveText("Ready");
  await expect(page.locator("#metric-elapsed")).toHaveText("0.0 s");
  await expect(
    page.getByRole("button", { name: "Block Exit A", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator("canvas")
      .evaluate((c) => (c as HTMLCanvasElement).toDataURL()),
  ).toBe(initial);
  expect(errors).toEqual([]);
});
test("stress controls expose actual browser cadence", async ({
  page,
}, info) => {
  await page.goto("/");
  for (const count of [200, 500]) {
    await page.getByLabel("Agent population").selectOption(String(count));
    await expect(page.locator("#metric-remaining")).toHaveText(String(count));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect
      .poll(async () =>
        parseFloat(await page.locator("#metric-elapsed").innerText()),
      )
      .toBeGreaterThanOrEqual(5);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(500);
      samples.push({
        fps: Number(await page.locator("#metric-fps").innerText()),
        frame: await page.locator("#metric-frame").innerText(),
      });
    }
    await info.attach(`performance-${count}`, {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    console.log(`Browser stress ${count}:`, JSON.stringify(samples));
    expect(samples.every((s) => s.fps > 0)).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`stress-${count}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel("Routing strategy").selectOption("shortest");
  await expect(page.locator("#status")).toHaveText("Ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
