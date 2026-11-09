/**
 * Chronicle — headless UI test (Playwright).
 * 1. Opens the app, clicks "Enter as Alex" (one-click demo login).
 * 2. Clicks the "Reconstruct" stepper step.
 * 3. Clicks "Reconstruct & Verify Project State".
 * 4. Asserts the page shows "Verified" claim badges (literal clicks work).
 *
 * Uses an installed Edge/Chrome channel by default to avoid downloading
 * browser binaries; override with PW_CHANNEL (e.g. "chromium").
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const channel = process.env.PW_CHANNEL?.trim() || "msedge";

const browser = await chromium.launch({ headless: true, channel });
try {
  const page = await browser.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // 1. One-click entry: click "Enter as Alex"
  const alexButton = page.getByRole("button", { name: /Enter as Alex/ });
  await alexButton.waitFor({ timeout: 15000 });
  await alexButton.click();

  // Entry click triggers a reload; wait for the workspace shell.
  const stepperReconstruct = page.getByRole("button", { name: /Reconstruct/ }).first();
  await stepperReconstruct.waitFor({ timeout: 15000 });

  // 2. Go to the Reconstruct stage.
  await stepperReconstruct.click();

  // 3. Run the reconstruct + verify pipeline.
  const runButton = page.getByRole("button", { name: /Reconstruct & Verify Project State/ });
  await runButton.waitFor({ timeout: 15000 });
  await runButton.click();

  // 4. Verification renders "Verified" status badges.
  await page.waitForFunction(
    () => document.body.innerText.includes("Verified"),
    null,
    { timeout: 20000 }
  );
  console.log("PASS UI: clicked 'Enter as Alex', ran Reconstruct, page shows 'Verified'.");
} finally {
  await browser.close();
}
