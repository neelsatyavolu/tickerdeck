import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { aiModels } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

export function GET() {
  return withUser(async () => NextResponse.json(await aiModels()));
}
