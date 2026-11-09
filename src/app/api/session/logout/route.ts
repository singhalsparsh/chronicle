import { NextResponse } from "next/server";
import { sessionCookieHeader } from "@/lib/auth/get-viewer";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookieHeader("", { clear: true }));
  return res;
}
