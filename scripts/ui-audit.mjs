/**
 * Chronicle — hostile UI audit: Jordan (T1) must see Lock and Reset
 * as disabled (server-side 403 confirmed separately; here we verify the
 * UI does not lie about it), and the login surface has the 3 roles.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const channel = process.env.PW_CHANNEL?.trim() || "msedge";

const browser = await chromium.launch({ headless: true, channel });
try {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // 1. Entry screen shows the three demo roles (one-click).
  for (const name of ["Enter as Alex", "Enter as Sam", "Enter as Jordan"]) {
    const btn = page.getByRole("button", { name: new RegExp(name) });
    await btn.waitFor({ timeout: 10000 });
  }
  console.log("PASS UI: three one-click demo entries present");

  // 2. Enter as Jordan (T1).
  await page.getByRole("button", { name: /Enter as Jordan/ }).click();
  await page.getByRole("button", { name: /Reconstruct/ }).first().waitFor({ timeout: 15000 });

  // 3. Handover stage: Lock button must be disabled for T1.
  await page.getByRole("button", { name: /Handover/ }).click();
  const lock = page.getByRole("button", { name: /Lock/i }).first();
  await lock.waitFor({ timeout: 15000 });
  const lockDisabled = await lock.isDisabled();
  const lockHint = await page.getByText(/Requires Maintainer/).count();
  console.log(
    `${lockDisabled ? "PASS" : "FAIL"} UI: Lock disabled for T1 (disabled=${lockDisabled}, hintElements=${lockHint})`
  );

  // 4. Stepper Reset button must be disabled for T1.
  const reset = page.getByRole("button", { name: /Reset/i }).first();
  await reset.waitFor({ timeout: 10000 });
  const resetDisabled = await reset.isDisabled();
  const resetLabel = await reset.getAttribute("aria-label");
  console.log(
    `${resetDisabled ? "PASS" : "FAIL"} UI: Reset disabled for T1 (disabled=${resetDisabled}, ariaLabel="${resetLabel}")`
  );

  if (!lockDisabled || !resetDisabled) process.exit(1);
} finally {
  await browser.close();
}
