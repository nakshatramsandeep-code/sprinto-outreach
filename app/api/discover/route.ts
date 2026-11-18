import { route } from "@/lib/api";
import { discover } from "@/lib/discover";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const POST = route(async () => discover() as unknown as Record<string, unknown>);
