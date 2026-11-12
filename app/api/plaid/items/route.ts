import { ok, withUser } from "@/lib/api";
import { plaidConfigFor } from "@/lib/plaid/config";
import { listItems } from "@/lib/plaid/repo";
import type { PlaidItem } from "@/lib/plaid/types";

export const dynamic = "force-dynamic";

// GET /api/plaid/items — the linked brokerages, and whether this user may
// link any. The one brokerage route that answers everyone, so Settings can
// tell whether to show the section.
export function GET() {
  return withUser(async ({ user }) => {
    const enabled = plaidConfigFor(user.id) !== null;
    return ok<{ enabled: boolean; items: PlaidItem[] }>({ enabled, items: enabled ? await listItems(user.id) : [] });
  });
}
