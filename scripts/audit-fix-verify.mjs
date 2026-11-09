/**
 * Chronicle — verification of hostile-audit deduction fixes.
 * 1. Copy fix (28 -> 8) is checked statically.
 * 2. Lock is blocked client-side while conflicts are unresolved (red toast).
 * 3. Ingest API reports factsExtracted; UI warns when 0 facts extracted.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const channel = process.env.PW_CHANNEL?.trim() || "msedge";

async function req(method, path, { cookie, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, text, data, setCookie: res.headers.get("set-cookie") };
}

const login = async (userId) => {
  const r = await req("POST", "/api/session", { body: { userId } });
  if (r.status !== 200 || !r.setCookie) throw new Error(`login ${userId} failed: ${r.status}`);
  return r.setCookie.split(";")[0];
};

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
  if (!cond) failures += 1;
};

/* ---------------- 1. copy fix (static) ---------------- */
import { readFileSync } from "node:fs";
const stepper = readFileSync(new URL("../src/components/top-nav-stepper.tsx", import.meta.url), "utf8");
check("copy: reset dialog says 8-artifact (no 28)", stepper.includes("8-artifact") && !stepper.includes("28-artifact"));

/* ---------------- 3. ingest factsExtracted (API) ---------------- */
const alex = await login("alex");
await req("POST", "/api/handover", { cookie: alex, body: { action: "reset_demo" } });

const boiler = await req("POST", "/api/ingest", {
  cookie: alex,
  body: {
    title: "Random Notes Dump",
    sourceType: "JIRA_TICKET",
    author: "@audit_judge",
    rawText: "Just some random notes and idle chit-chat with nobody in particular about weather and food.",
    accessTier: 3,
  },
});
check(
  "ingest: boilerplate text -> factsExtracted=0",
  boiler.status === 200 && boiler.data?.factsExtracted === 0,
  `status=${boiler.status} factsExtracted=${boiler.data?.factsExtracted}`
);

const trigger = await req("POST", "/api/ingest", {
  cookie: alex,
  body: {
    title: "Decision Trigger Text",
    sourceType: "JIRA_TICKET",
    author: "@audit_judge",
    rawText: "We decided to migrate staging to use the deployment token for zero-downtime deploys.",
    accessTier: 3,
  },
});
check(
  "ingest: trigger text -> factsExtracted>=1",
  trigger.status === 200 && trigger.data?.factsExtracted >= 1,
  `status=${trigger.status} factsExtracted=${trigger.data?.factsExtracted}`
);

/* ---------------- 2. lock blocked in UI with red toast ---------------- */
const browser = await chromium.launch({ headless: true, channel });
try {
  const page = await browser.newPage();

  // fresh session, no bogus cookies
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Enter as Alex/ }).click();
  await page.getByRole("button", { name: /Reconstruct/ }).first().waitFor({ timeout: 15000 });

  // go to Handover (stage 5)
  await page.getByRole("button", { name: /Handover/ }).click();
  const lock = page.getByRole("button", { name: /Lock & Publish/ });
  await lock.waitFor({ timeout: 15000 });

  // unresolved conflicts exist after reset; click lock; must NOT lock and show red toast
  await lock.click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Cannot lock snapshot: Resolve all conflicts first."),
    null,
    { timeout: 15000 }
  );
  const stillUnlocked = await page.getByRole("button", { name: /Lock & Publish/ }).count();
  const toastText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-sonner-toast], [role="status"]'));
    return els.map((e) => e.textContent ?? "").join(" | ");
  });
  check("lock: blocked while conflicts unresolved + red toast", stillUnlocked === 1, `lock button still present=${stillUnlocked > 0} toast="${toastText.slice(0, 120)}"`);

  // now resolve both conflicts via API, then lock should succeed from UI
  await req("POST", "/api/handover", { cookie: alex, body: { action: "resolve_conflict", conflictId: "CT-001", choice: "SOURCE_A" } });
  await req("POST", "/api/handover", { cookie: alex, body: { action: "resolve_conflict", conflictId: "CT-002", choice: "SOURCE_A" } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Reconstruct/ }).first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Handover/ }).click();
  await page.getByRole("button", { name: /Lock & Publish/ }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Lock & Publish/ }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Snapshot v1.0 locked"),
    null,
    { timeout: 15000 }
  );
  check("lock: succeeds after all conflicts resolved", true);
} finally {
  await browser.close();
}

console.log(`\n==== FIX VERIFICATION: ${failures === 0 ? "ALL PASS" : failures + " FAILED"} ====`);
process.exit(failures === 0 ? 0 : 1);
