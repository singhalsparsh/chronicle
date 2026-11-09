/**
 * Chronicle — shared route helper utilities.
 */
import { NextResponse } from "next/server";

export function jsonError(status: number, code: string, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status }
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T | NextResponse> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
