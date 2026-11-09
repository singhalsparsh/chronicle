import { NextResponse } from "next/server";
import { readSessionToken, revokeSessionToken, sessionCookieHeader } from "@/lib/auth/get-viewer";

export async function POST(request: Request) {
  const token = readSessionToken(request);
  if (token) revokeSessionToken(token);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookieHeader("", { clear: true }));
  return res;
}
