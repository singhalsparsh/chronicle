/**
 * Chronicle — Demo identities (E-1b).
 *
 * Hardcoded, no DB, no passwords. Tier is NEVER derived from anything the
 * client sends except a userId that is validated against this map.
 */
export const DEMO_USERS = {
  alex: { id: "alex", name: "Alex", role: "Maintainer", tier: 3 },
  sam: { id: "sam", name: "Sam", role: "Engineer", tier: 2 },
  jordan: { id: "jordan", name: "Jordan", role: "Contractor", tier: 1 },
} as const;

export type DemoUserId = keyof typeof DEMO_USERS;

export type DemoUser = (typeof DEMO_USERS)[DemoUserId];

export function getUserById(id: string): DemoUser | null {
  if (id in DEMO_USERS) return DEMO_USERS[id as DemoUserId];
  return null;
}
