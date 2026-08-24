import { z } from "zod";
import type { RichNode } from "./template-engine";

const allowedNodes = new Set(["doc", "paragraph", "text", "bulletList", "orderedList", "listItem", "hardBreak", "blockquote", "heading"]);
const allowedMarks = new Set(["bold", "italic", "strike", "code", "link"]);

export const richDocumentSchema = z.record(z.string(), z.unknown()).transform((value) => sanitizeRichDocument(value as RichNode));
export const templateCreateSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional().default("") });
export const templateUpdateSchema = templateCreateSchema.partial().refine((value) => Object.keys(value).length > 0);
export const stepCreateSchema = z.object({ title: z.string().trim().min(1).max(300), body: richDocumentSchema, repeatVariableId: z.uuid().nullable().optional() });
export const stepUpdateSchema = stepCreateSchema.partial().refine((value) => Object.keys(value).length > 0);
export const organizationLookupSchema = z.object({ id: z.string().trim().regex(/^\d+$/).optional(), exactName: z.string().trim().min(1).max(200).optional() }).refine((value) => value.id || value.exactName);
export const organizationEnableSchema = z.object({ itglueId: z.string().trim().regex(/^\d+$/), name: z.string().trim().min(1).max(200) });

export function sanitizeRichDocument(input: RichNode, depth = 0): RichNode {
  if (depth > 20) return { type: "paragraph", content: [] };
  const type = allowedNodes.has(String(input.type)) ? String(input.type) : "paragraph";
  const node: RichNode = { type };
  if (type === "text") node.text = String(input.text ?? "").slice(0, 20_000);
  if (type === "text" && Array.isArray(input.marks)) {
    const marks = input.marks.slice(0, 20).flatMap((mark) => {
      if (!mark || typeof mark !== "object" || !allowedMarks.has(String(mark.type))) return [];
      if (mark.type !== "link") return [{ type: String(mark.type) }];
      const href = String((mark.attrs as Record<string, unknown> | undefined)?.href ?? "");
      if (!/^(https?:|mailto:)/i.test(href)) return [];
      return [{ type: "link", attrs: { href: href.slice(0, 2048), target: "_blank", rel: "noopener noreferrer nofollow" } }];
    });
    if (marks.length) node.marks = marks;
  }
  if (Array.isArray(input.content)) node.content = input.content.slice(0, 1000).map((child) => sanitizeRichDocument(child, depth + 1));
  if (type === "heading" && input.attrs && [1, 2, 3].includes(Number(input.attrs.level))) node.attrs = { level: Number(input.attrs.level) };
  return node;
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new InputError("content_type_must_be_json");
  try { return schema.parse(await request.json()); }
  catch { throw new InputError("invalid_request_body"); }
}

export class InputError extends Error {}

export function errorResponse(error: unknown) {
  if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
  console.error("Request failed", error instanceof Error ? { name: error.name, message: error.message } : { message: "Unknown error" });
  return Response.json({ error: "request_failed" }, { status: 500 });
}
