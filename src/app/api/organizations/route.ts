import { asc, isNull } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse, organizationEnableSchema, organizationLookupSchema, readJson } from "@/lib/input";
import { ItGlueClient } from "@/lib/itglue";

export async function GET() {
  const access = await requireRole("viewer"); if (!access.ok) return access.response;
  return Response.json({ data: await getDatabase().select().from(organizations).where(isNull(organizations.deletedAt)).orderBy(asc(organizations.name)) });
}

export async function POST(request: Request) {
  const access = await requireRole("admin"); if (!access.ok) return access.response;
  try {
    const action = new URL(request.url).searchParams.get("action");
    if (action === "lookup") {
      const input = await readJson(request, organizationLookupSchema);
      const client = new ItGlueClient({ apiKey: requiredEnv("ITGLUE_API_KEY"), baseUrl: process.env.ITGLUE_BASE_URL, onRequestPreview: async (preview) => recordAudit({ actorUserId: access.user.id, eventType: "itglue.request.preview", entityType: "organization_lookup", details: preview }) });
      return Response.json({ data: await client.lookupOrganization(input) });
    }
    const input = await readJson(request, organizationEnableSchema);
    const [created] = await getDatabase().insert(organizations).values(input).onConflictDoUpdate({ target: organizations.itglueId, set: { name: input.name, enabled: true, deletedAt: null, updatedAt: new Date() } }).returning();
    await recordAudit({ actorUserId: access.user.id, eventType: "organization.enabled", entityType: "organization", entityId: created.id, details: { itglueId: created.itglueId, name: created.name } });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

function requiredEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
