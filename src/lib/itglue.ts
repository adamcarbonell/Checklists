import type { SelectedField } from "@/db/schema";
import type { ProjectedAsset } from "./variable-validation";

const ALLOWED_BASE_URLS = new Set(["https://api.itglue.com", "https://api.eu.itglue.com", "https://api.au.itglue.com"]);
const MAX_RECORDS = 1000;

export type RequestPreview = {
  method: "GET";
  endpoint: "/flexible_assets" | "/flexible_asset_types" | "/organizations";
  filters: Record<string, string>;
  projectedFields: string[];
  resultLimit: number;
  dataSensitivity: "tenant-schema" | "organization-metadata" | "organization-documentation";
  possibleSideEffects: "none-read-only";
};

export type ItGlueClientOptions = {
  apiKey: string;
  baseUrl?: string;
  onRequestPreview: (preview: RequestPreview) => Promise<void>;
  fetcher?: typeof fetch;
};

type JsonApiResource = { id: string; attributes?: Record<string, unknown> };
type JsonApiResponse = { data?: JsonApiResource[]; meta?: Record<string, unknown>; links?: Record<string, unknown> };

export class ItGlueClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly onRequestPreview: ItGlueClientOptions["onRequestPreview"];
  private readonly fetcher: typeof fetch;

  constructor(options: ItGlueClientOptions) {
    const baseUrl = (options.baseUrl ?? "https://api.itglue.com").replace(/\/$/, "");
    if (!ALLOWED_BASE_URLS.has(baseUrl)) throw new Error("IT Glue base URL is not an approved regional endpoint.");
    if (!options.apiKey.trim()) throw new Error("ITGLUE_API_KEY is required.");
    this.apiKey = options.apiKey;
    this.baseUrl = baseUrl;
    this.onRequestPreview = options.onRequestPreview;
    this.fetcher = options.fetcher ?? fetch;
  }

  async getFlexibleAssets(input: { organizationId: string; assetTypeId: string; selectedFields: SelectedField[] }): Promise<ProjectedAsset[]> {
    const filters = { "flexible-asset-type-id": input.assetTypeId, "organization-id": input.organizationId };
    await this.onRequestPreview({
      method: "GET",
      endpoint: "/flexible_assets",
      filters,
      projectedFields: input.selectedFields.map((field) => field.sourceKey),
      resultLimit: MAX_RECORDS,
      dataSensitivity: "organization-documentation",
      possibleSideEffects: "none-read-only",
    });
    const url = new URL(`${this.baseUrl}/flexible_assets`);
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(`filter[${key}]`, value);
    url.searchParams.set("page[size]", String(MAX_RECORDS));
    const payload = await this.request(url);
    if (!Array.isArray(payload.data)) throw new ItGlueMalformedError("flexible_assets_data_not_array");
    const resources = payload.data;
    const totalCount = Number(payload.meta?.["total-count"] ?? resources.length);
    if (totalCount > MAX_RECORDS || payload.links?.next) throw new ItGlueLimitError(totalCount);
    return resources
      .filter((resource) => resource.attributes?.archived !== true)
      .map((resource) => projectAsset(resource, input.selectedFields));
  }

  async lookupOrganization(input: { id?: string; exactName?: string }) {
    if (!input.id && !input.exactName) throw new Error("An organization ID or exact name is required.");
    const filters: Record<string, string> = input.id ? { id: input.id } : { name: input.exactName! };
    await this.onRequestPreview({ method: "GET", endpoint: "/organizations", filters, projectedFields: ["id", "name"], resultLimit: 25, dataSensitivity: "organization-metadata", possibleSideEffects: "none-read-only" });
    const url = new URL(`${this.baseUrl}/organizations`);
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(`filter[${key}]`, value);
    url.searchParams.set("page[size]", "25");
    const payload = await this.request(url);
    if (!Array.isArray(payload.data)) throw new ItGlueMalformedError("organizations_data_not_array");
    return payload.data.map((resource) => ({ id: resource.id, name: String(resource.attributes?.name ?? "") })).filter((organization) => organization.name);
  }

  async getFlexibleAssetType(id: string) {
    await this.onRequestPreview({ method: "GET", endpoint: "/flexible_asset_types", filters: { id }, projectedFields: ["id", "name", "fields.key", "fields.kind"], resultLimit: 1, dataSensitivity: "tenant-schema", possibleSideEffects: "none-read-only" });
    const payload = await this.request(new URL(`${this.baseUrl}/flexible_asset_types/${encodeURIComponent(id)}`));
    const resource = Array.isArray(payload.data) ? payload.data[0] : (payload.data as unknown as JsonApiResource | undefined);
    if (!resource) throw new Error("Flexible asset type was not found.");
    const attributes = resource.attributes ?? {};
    const rawFields = Array.isArray(attributes["flexible-asset-fields"]) ? attributes["flexible-asset-fields"] : [];
    const fields = rawFields.flatMap((entry) => {
      if (!isObject(entry)) return [];
      const fieldAttributes = isObject(entry.attributes) ? entry.attributes : entry;
      const key = String(fieldAttributes.key ?? fieldAttributes["api-key"] ?? fieldAttributes.name ?? "");
      const kind = String(fieldAttributes.kind ?? fieldAttributes.type ?? "");
      return key ? [{ key, name: String(fieldAttributes.name ?? key), kind }] : [];
    }).slice(0, 1000);
    return { id: resource.id, name: String(attributes.name ?? ""), fields };
  }

  private async request(url: URL): Promise<JsonApiResponse> {
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      const response = await this.fetcher(url, { method: "GET", headers: { "x-api-key": this.apiKey, Accept: "application/vnd.api+json" }, cache: "no-store" });
      if (response.ok) return await response.json() as JsonApiResponse;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Math.min(Number(response.headers.get("retry-after") ?? 0) * 1000 || 500 * (2 ** (attempt - 1)), 5000);
        await new Promise((resolve) => setTimeout(resolve, retryAfter));
        continue;
      }
      throw new ItGlueHttpError(response.status);
    }
    throw new ItGlueHttpError(503);
  }
}

export class ItGlueHttpError extends Error {
  constructor(public readonly status: number) { super(`IT Glue request failed with status ${status}.`); }
}
export class ItGlueLimitError extends Error {
  constructor(public readonly totalCount: number) { super(`IT Glue result exceeds the ${MAX_RECORDS}-record safety limit.`); }
}
export class ItGlueMalformedError extends Error {}

function projectAsset(resource: JsonApiResource, fields: SelectedField[]): ProjectedAsset {
  const attributes = resource.attributes ?? {};
  const traits = isObject(attributes.traits) ? attributes.traits : {};
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = field.sourceKey === "name" ? attributes.name : traits[field.sourceKey];
    projected[field.alias] = normalizeTrait(raw);
  }
  return { id: resource.id, name: String(attributes.name ?? resource.id), updatedAt: typeof attributes["updated-at"] === "string" ? attributes["updated-at"] : undefined, fields: projected };
}

function normalizeTrait(value: unknown): unknown {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_RECORDS).map(normalizeTrait);
  if (isObject(value) && Array.isArray(value.values)) {
    return value.values.slice(0, MAX_RECORDS).map((entry): Record<string, string> | null => isObject(entry) ? { id: String(entry.id ?? ""), name: String(entry.name ?? "") } : null).filter((entry): entry is Record<string, string> => entry !== null);
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
