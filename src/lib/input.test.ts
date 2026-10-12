import { expect, it, vi } from "vitest";
import { errorResponse } from "./input";

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
