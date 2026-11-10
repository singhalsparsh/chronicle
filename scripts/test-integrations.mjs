/**
 * Chronicle — integration probe for the optional persistence/LLM paths.
 *
 * This script intentionally bypasses the USE_SUPABASE=false gate (demo default)
 * so the code paths themselves are exercised: it writes/reads a dummy row in
 * Supabase `chronicle_state` and makes a direct 1-sentence Gemini/OpenAI call.
 * It reads credentials from `.env.local` (active OR commented lines), so the
 * main demo can keep them disabled while this probe still runs.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

function loadEnv() {
  const out = {};
  if (!existsSync(ENV_PATH)) return out;
  for (const rawLine of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#=") || line.startsWith("# ---")) continue;
    const active = !line.startsWith("#");
    const body = (active ? line : line.slice(1)).trim();
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

const env = loadEnv();

async function reqJson(url, init, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- Supabase */
async function testSupabase() {
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    console.log("SKIP Supabase (no credentials present in .env.local)");
    return;
  }
  const id = `integration-probe-${Date.now()}`;
  const target = `${base}/rest/v1/chronicle_state`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };

  const write = await reqJson(
    target,
    { method: "POST", headers, body: JSON.stringify({ id, state: { probe: true, at: new Date().toISOString() } }) },
    15000
  );
  if (write.status < 200 || write.status >= 300) {
    throw new Error(`Supabase write failed (${write.status}): ${JSON.stringify(write.data).slice(0, 300)}`);
  }

  const read = await reqJson(`${target}?select=id,state&id=eq.${encodeURIComponent(id)}`, { headers }, 15000);
  const row = Array.isArray(read.data) ? read.data.find((r) => r.id === id) : null;
  if (read.status !== 200 || !row || !row.state || row.state.probe !== true) {
    throw new Error(`Supabase read-back failed (${read.status}): ${JSON.stringify(read.data).slice(0, 300)}`);
  }

  // cleanup
  await reqJson(`${target}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers }, 15000);

  console.log("PASS Supabase Read/Write");
}

/* --------------------------------------------------------------------- LLM */
async function testLlm() {
  const geminiKey = env.GEMINI_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  if (!geminiKey && !openaiKey) {
    console.log("SKIP LLM (no API key present in .env.local)");
    return;
  }

  const prompt =
    'Reply with strict JSON only: {"ok": true, "sentence": "A single 1-sentence proof output."}';

  if (geminiKey) {
    const model = env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await reqJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (res.status !== 200 || !raw) {
      throw new Error(`Gemini call failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    const parsed = JSON.parse(raw);
    if (parsed.ok !== true) throw new Error(`Gemini did not honor JSON contract: ${raw.slice(0, 200)}`);
    console.log("PASS LLM API Response");
    return;
  }

  if (openaiKey) {
    const res = await reqJson("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output strict JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = res.data?.choices?.[0]?.message?.content;
    if (res.status !== 200 || !raw) {
      throw new Error(`OpenAI call failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    const parsed = JSON.parse(raw);
    if (parsed.ok !== true) throw new Error(`OpenAI did not honor JSON contract: ${raw.slice(0, 200)}`);
    console.log("PASS LLM API Response");
  }
}

/* -------------------------------------------------------------------- main */
let failures = 0;
const run = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}: ${error.message}`);
  }
};

await run("Supabase", testSupabase);
await run("LLM", testLlm);

if (failures > 0) {
  console.log(`\n${failures} integration check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll integration checks passed.");
