import { test, expect } from "@playwright/test";
test("controls, pause, dynamic closure, completion and reset", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#menu-screen")).toBeVisible();
  await expect(page.locator("#simulation-screen")).toBeHidden();
  await page.locator("#setup-map").selectOption("mvp");
  await page.getByRole("button", { name: "Start experiment", exact: true }).click();
  await expect(page.locator("#map")).toHaveValue("mvp");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Ready");
  await expect(page.locator("#metric-remaining")).toHaveText("100");
  const initial = await page
    .locator("canvas")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("#menu-screen")).toBeHidden();
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
  await expect(page.locator("#results-screen")).toBeVisible();
  await expect(page.locator("#results-heading")).toBeFocused();
  await expect(page.locator("#simulation-screen")).toBeHidden();
  await expect(page.locator("#result-evacuated")).toHaveText("100 / 100");
  await expect(page.locator("#result-exitB")).toHaveText("100");
  await expect(page.locator("#result-clearA")).toHaveText("Unused");
  await expect(page.locator("#result-total")).not.toHaveText("—");
  await page.screenshot({ path: info.outputPath("results.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("results-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Run again", exact: true }).click();
  await expect(page.locator("#results-screen")).toBeHidden();
  await expect(page.locator("#status")).toHaveText("Running");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
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
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  await expect(page.locator("#menu-screen")).toBeVisible();
  await expect(page.locator("#menu-heading")).toBeFocused();
  expect(errors).toEqual([]);
});
test("larger map is the default and switching layouts resets canvas and crowd", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator("#setup-map")).toHaveValue("large");
  await page.getByRole("button", { name: "Start experiment", exact: true }).click();
  await expect(page.locator("#map")).toHaveValue("large");
  await expect(page.locator("canvas")).toHaveAttribute("width", "1400");
  await expect(page.locator("canvas")).toHaveAttribute("height", "840");
  await page.screenshot({
    path: info.outputPath("large-map.png"),
    fullPage: true,
  });
  await expect
    .poll(async () =>
      parseFloat(await page.locator("#metric-elapsed").innerText()),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Block Exit A", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator("#metric-switches").innerText()),
    )
    .toBeGreaterThan(0);
  await page.locator("#map").selectOption("mvp");
  await expect(page.locator("canvas")).toHaveAttribute("width", "1000");
  await expect(page.locator("#status")).toHaveText("Ready");
  await expect(page.locator("#metric-remaining")).toHaveText("100");
  await page.locator("#map").selectOption("large");
  await expect(page.locator("canvas")).toHaveAttribute("width", "1400");
  await expect(
    page.getByRole("button", { name: "Block Exit A", exact: true }),
  ).toBeVisible();
});
test("stress controls expose actual browser cadence", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start experiment", exact: true }).click();
  for (const count of [200, 500]) {
    await page.locator("#population").fill(String(count));
    await page.getByRole("button", { name: "Apply crowd size", exact: true }).click();
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
  await page.locator("#routing").selectOption("shortest");
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

test("setup, scheduled closure, reopening, reset and mobile navigation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.screenshot({ path: info.outputPath("setup.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const setup = page.locator("#menu-screen");
  await setup.getByLabel("Agent population", { exact: true }).fill("200");
  await setup.getByLabel("Routing strategy", { exact: true }).selectOption("shortest");
  await setup.getByLabel("Exit scenario", { exact: true }).selectOption("closure");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("setup-mobile.png"), fullPage: true });
  await setup.getByRole("button", { name: "Start experiment" }).click();
  await expect(page.locator("#population")).toHaveValue("200");
  await expect(page.locator("#routing")).toHaveValue("shortest");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Paused");
  const countdown = await page.locator("#scenario-status").innerText();
  await page.waitForTimeout(300);
  await expect(page.locator("#scenario-status")).toHaveText(countdown);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("#scenario-status")).toContainText("Scheduled closure applied");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Re-open Exit A", exact: true }).click();
  await expect(page.locator("#scenario-status")).toContainText("reopened");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#scenario-status")).toContainText("5.0 simulation seconds");
  await expect(page.locator("#evacuation-progress")).toHaveAttribute("value", "0");
  await expect(page.locator("#metric-remaining")).toHaveText("200");
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  await expect(setup.getByLabel("Exit scenario", { exact: true })).toHaveValue("closure");
  await expect(setup.getByLabel("Building layout", { exact: true })).toHaveValue("large");
  await expect(setup.getByLabel("Agent population", { exact: true })).toHaveValue("200");
  await setup.getByRole("button", { name: "Start experiment" }).click();
  await expect(page.locator("#status")).toHaveText("Running");
  await expect(page.locator("#metric-exitA")).toHaveText("0");
  expect(errors).toEqual([]);
});
