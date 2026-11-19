import { test, expect } from "@playwright/test";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#setup-map").selectOption("stadium");
  await page.getByRole("button", { name: "Open stadium", exact: true }).click();
}

test("destination colors, selected personal routes, section routes and closure replacements stay linked", async ({ page }) => {
  await open(page);
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("44");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("lower-bowl");
  await page.getByLabel("Crowd behavior", { exact: true }).selectOption("uniform");
  await page.getByLabel("Inspect a spectator", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  const circle = page.locator('#stadium-crowd-agents [data-person="0"]');
  await expect(circle).not.toHaveAttribute("data-gate", "unassigned");
  const gateId = await circle.getAttribute("data-gate");
  const circleColor = await circle.evaluate(element => getComputedStyle(element).fill);
  const gateColor = await page.locator(`[data-feature="${gateId}"] rect`).evaluate(element => getComputedStyle(element).fill);
  expect(circleColor).toBe(gateColor);
  await expect.poll(() => page.locator("#stadium-committed-routes path").count()).toBeGreaterThan(0);
  expect(await page.locator("#stadium-committed-routes path").first().evaluate(element => getComputedStyle(element).stroke)).toBe(circleColor);
  await expect(page.locator("#stadium-active-route path")).toHaveCount(0);
  await page.getByText("Reference-speed route preview", { exact: true }).click();
  await expect.poll(() => page.locator("#stadium-active-route path").count()).toBeGreaterThan(0);

  const sectionId = await circle.getAttribute("data-section");
  await page.getByLabel("Inspect a section, gate or connection").selectOption(sectionId!);
  await expect.poll(() => page.locator(`#stadium-crowd-agents [data-section="${sectionId}"][data-section-selected="true"]`).count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#stadium-committed-routes path").count()).toBeGreaterThan(0);

  await page.getByLabel("Inspect a section, gate or connection").selectOption(gateId!);
  await page.getByRole("button", { name: "Close gate group", exact: true }).click();
  await page.getByLabel("Inspect a spectator", { exact: true }).selectOption("0");
  await expect(page.locator("#stadium-person-replacement")).toContainText("Gate closed:");
  await expect(circle).not.toHaveAttribute("data-gate", gateId!);
});

test("blocked routes use a prominent warning while unassigned spectators remain neutral", async ({ page }) => {
  await open(page);
  const neutral = page.locator('#stadium-crowd-agents [data-person="0"]');
  await expect(neutral).toHaveAttribute("data-gate", "unassigned");
  await page.getByText("Crowd configuration", { exact: true }).click();
  await page.getByLabel("Spectators", { exact: true }).fill("6");
  await page.getByLabel("Starting seats", { exact: true }).selectOption("upper-east");
  await page.getByLabel("Inspect a section, gate or connection").selectOption("ramp-east");
  await page.getByRole("button", { name: "Close connection", exact: true }).click();
  await page.getByRole("button", { name: "Start stadium run", exact: true }).click();
  await expect(page.locator("#stadium-blocked-warning")).toContainText("6 spectators");
  await expect(page.locator('#stadium-crowd-agents [data-state="stranded"]')).toHaveCount(6);
  await expect(page.locator('#stadium-crowd-agents [data-state="stranded"]').first()).toHaveAttribute("data-gate", "unassigned");
});
