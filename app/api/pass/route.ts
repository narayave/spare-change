import { getPass } from "@/lib/db";
import { normalizeCode } from "@/lib/meter";

// POST so the pass code (a bearer credential) stays out of URLs and access logs.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = normalizeCode(body?.code);
  const pass = code && (await getPass(code));
  if (!pass) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(pass, { headers: { "Cache-Control": "no-store" } });
}
