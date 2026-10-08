import { NextResponse } from "next/server";
import { aiModels } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await aiModels());
}
