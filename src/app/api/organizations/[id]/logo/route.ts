import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { organizationLogos, organizations } from "@/db/schema";
import { requireRole } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/input";
import { organizationLogoMaxBytes, organizationLogoTypes } from "@/lib/organization-logo-input";
import { OrderError } from "@/lib/template-order";
import { loadOrganization } from "@/lib/workspace-data";

type Context = RouteContext<"/api/organizations/[id]/logo">;

export async function GET(_request: Request, context: Context) {
  const access = await requireRole("viewer");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    const [logo] = await getDatabase().select({ mimeType: organizationLogos.mimeType, image: organizationLogos.image })
      .from(organizationLogos).innerJoin(organizations, eq(organizations.id, organizationLogos.organizationId))
      .where(and(eq(organizationLogos.organizationId, id), eq(organizations.enabled, true), isNull(organizations.deletedAt)));
    if (!logo) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new Response(Uint8Array.from(logo.image), {
      headers: {
        "Content-Type": logo.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  const access = await requireRole("admin");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    const mimeType = request.headers.get("content-type") ?? "";
    if (!organizationLogoTypes.includes(mimeType)) throw new OrderError("invalid_logo_type", 415);
    const image = await readImage(request);
    if (!matchesImageType(image, mimeType)) throw new OrderError("invalid_logo_type", 415);
    const version = crypto.randomUUID();
    await getDatabase().transaction(async (tx) => {
      if (!await loadOrganization(id, tx)) throw new OrderError("organization_not_found", 404);
      await tx.insert(organizationLogos).values({ organizationId: id, mimeType, image, version })
        .onConflictDoUpdate({ target: organizationLogos.organizationId, set: { mimeType, image, version } });
      await recordAudit({ actorUserId: access.user.id, entityType: "organization", entityId: id,
        eventType: "organization.logo_saved", details: { mimeType, size: image.byteLength } }, tx);
    });
    return Response.json({ version });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  const access = await requireRole("admin");
  if (!access.ok) return access.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    await getDatabase().transaction(async (tx) => {
      if (!await loadOrganization(id, tx)) throw new OrderError("organization_not_found", 404);
      const [removed] = await tx.delete(organizationLogos).where(eq(organizationLogos.organizationId, id))
        .returning({ organizationId: organizationLogos.organizationId });
      if (removed) await recordAudit({ actorUserId: access.user.id, entityType: "organization", entityId: id,
        eventType: "organization.logo_removed" }, tx);
    });
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}

async function readImage(request: Request) {
  if (Number(request.headers.get("content-length")) > organizationLogoMaxBytes) {
    throw new OrderError("logo_too_large", 413);
  }
  if (!request.body) throw new OrderError("invalid_logo_type", 415);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > organizationLogoMaxBytes) {
        await reader.cancel();
        throw new OrderError("logo_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function matchesImageType(image: Buffer, mimeType: string) {
  switch (mimeType) {
    case "image/png": return image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/jpeg": return image.subarray(0, 3).toString("hex") === "ffd8ff";
    case "image/webp": return image.toString("latin1", 0, 4) === "RIFF" && image.toString("latin1", 8, 12) === "WEBP";
    case "image/gif": return ["GIF87a", "GIF89a"].includes(image.toString("latin1", 0, 6));
    default: return false;
  }
}
