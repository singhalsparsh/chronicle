import { cookies } from "next/headers";
import { parseSessionToken, SESSION_COOKIE } from "@/lib/auth/get-viewer";
import { getUserById } from "@/lib/auth/demo-users";
import { WorkspaceClient } from "./workspace-client";
import { EntryScreen } from "@/components/entry-screen";

export const instant = false;

export default async function Home() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const parsed = token ? parseSessionToken(token) : null;
  const user = parsed ? getUserById(parsed.userId) : null;

  if (!user) return <EntryScreen />;
  return <WorkspaceClient />;
}
