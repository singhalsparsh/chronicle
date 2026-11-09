import { NextResponse } from "next/server";
import { getUserById } from "@/lib/auth/demo-users";
import {
  createSessionToken,
  getViewer,
  sessionCookieHeader,
} from "@/lib/auth/get-viewer";

/**
 * POST /api/session — body { userId } → validate against DEMO_USERS, set the
 * signed session cookie, return the viewer. 400 for unknown userId.
 * GET /api/session — current user or { user: null }. Never 401.
 */
export async function GET(request: Request) {
  const viewer = await getViewer(request);
  return NextResponse.json({ ok: true, user: viewer });
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // fall through to validation
  }
  const userId = (body as { userId?: unknown } | null)?.userId;
  const user = typeof userId === "string" ? getUserById(userId) : null;
  if (!user) {
    return NextResponse.json(
      { error: { code: "INVALID_USER", message: "Unknown demo user." } },
      { status: 400 }
    );
  }

  const token = createSessionToken(user.id);
  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, tier: user.tier },
  });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
