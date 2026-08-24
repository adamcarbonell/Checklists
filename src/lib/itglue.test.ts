import { describe, expect, it, vi } from "vitest";
import { ItGlueClient, ItGlueLimitError, ItGlueMalformedError } from "./itglue";

const selectedFields = [{ sourceKey: "ad-full-name", alias: "value", expectedKind: "Text" }];

describe("IT Glue client safety", () => {
  it("previews a narrow read-only request and discards unselected traits", async () => {
    const preview = vi.fn(async () => undefined);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "1", attributes: { name: "AD", traits: { "ad-full-name": "acme.local", password: "discard-me" } } }], meta: { "total-count": 1 } }), { status: 200 }));
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: preview, fetcher });
    const result = await client.getFlexibleAssets({ organizationId: "20", assetTypeId: "107504", selectedFields });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", endpoint: "/flexible_assets", resultLimit: 1000, possibleSideEffects: "none-read-only" }));
    expect(result[0].fields).toEqual({ value: "acme.local" });
    expect(JSON.stringify(result)).not.toContain("discard-me");
  });

  it("rejects over-limit responses instead of truncating", async () => {
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => new Response(JSON.stringify({ data: [], meta: { "total-count": 1001 } }), { status: 200 }) });
    await expect(client.getFlexibleAssets({ organizationId: "20", assetTypeId: "107504", selectedFields })).rejects.toBeInstanceOf(ItGlueLimitError);
  });

  it("accepts exactly 1,000 records without a next page", async () => {
    const data = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), attributes: { traits: { "ad-full-name": `domain-${index}` } } }));
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => new Response(JSON.stringify({ data, meta: { "total-count": 1000 } }), { status: 200 }) });
    await expect(client.getFlexibleAssets({ organizationId: "20", assetTypeId: "107504", selectedFields })).resolves.toHaveLength(1000);
  });

  it("rejects malformed collection responses", async () => {
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => new Response(JSON.stringify({ data: { id: "wrong-shape" } }), { status: 200 }) });
    await expect(client.getFlexibleAssets({ organizationId: "20", assetTypeId: "107504", selectedFields })).rejects.toBeInstanceOf(ItGlueMalformedError);
  });

  it("ignores archived assets and retries a rate limit a bounded number of times", async () => {
    let calls = 0;
    const client = new ItGlueClient({ apiKey: "test-only", onRequestPreview: async () => undefined, fetcher: async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ data: [{ id: "1", attributes: { archived: true, traits: { "ad-full-name": "old" } } }, { id: "2", attributes: { traits: { "ad-full-name": "new" } } }] }), { status: 200 });
    } });
    const result = await client.getFlexibleAssets({ organizationId: "20", assetTypeId: "107504", selectedFields });
    expect(calls).toBe(2);
    expect(result).toHaveLength(1);
  });
});
