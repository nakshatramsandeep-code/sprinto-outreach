import { route } from "@/lib/api";
import { getLearning, MIN } from "@/lib/learning";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ ...(await getLearning()), min: MIN }));
