import { expect, it, vi } from "vitest";
import { errorResponse, stepCreateSchema, stepUpdateSchema } from "./input";

it.each(["O365 - ", "  O365 - User access  ", "x".repeat(299) + " "])(
  "preserves exact step-title whitespace: %j",
  (title) => {
    expect(stepCreateSchema.parse({ title, body: { type: "doc", content: [] } }).title).toBe(title);
    expect(stepUpdateSchema.parse({ title }).title).toBe(title);
  },
);

it.each(["", "   ", "\t\n", "x".repeat(301)])(
  "rejects blank or overlong titles without trimming: %j",
  (title) => {
    expect(stepCreateSchema.safeParse({ title, body: { type: "doc", content: [] } }).success).toBe(false);
    expect(stepUpdateSchema.safeParse({ title }).success).toBe(false);
  },
);

it("never logs or returns error payloads that might contain sensitive query parameters", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = errorResponse(new Error("private-test-payload"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "request_failed" });
    expect(log).toHaveBeenCalledWith("Request failed unexpectedly");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-test-payload",
    );
  } finally {
    log.mockRestore();
  }
});
