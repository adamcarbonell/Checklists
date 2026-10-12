import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Token = Record<string, unknown>;
type Config = {
  callbacks: {
    signIn: (args: { profile?: Record<string, unknown> }) => Promise<boolean>;
    jwt: (args: {
      token: Token;
      profile?: Record<string, unknown>;
    }) => Promise<Token | null>;
  };
};
const state = vi.hoisted(() => ({
  config: null as Config | null,
  disabled: false,
  role: "viewer",
}));
vi.mock("next-auth", () => ({
  default: (config: Config) => {
    state.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: () => ({ id: "microsoft-entra-id" }),
}));
vi.mock("@/db/client", () => ({
  hasDatabase: () => true,
  getDatabase: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [
            { id: "test-user", disabled: state.disabled, role: state.role },
          ],
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: "test-user", disabled: state.disabled, role: state.role },
          ],
        }),
      }),
    }),
  }),
}));
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ENTRA_TENANT_ID", "approved-test-tenant");
  vi.stubEnv("ENTRA_CLIENT_ID", "test-client-placeholder");
  vi.stubEnv("ENTRA_CLIENT_SECRET", "test-only-placeholder-not-a-credential");
  vi.stubEnv("AUTH_SECRET", "test-only-placeholder-not-a-credential");
  state.disabled = false;
  state.role = "viewer";
  await import("./auth");
});
afterEach(() => vi.unstubAllEnvs());

describe("tenant and enabled-user authentication", () => {
  it("rejects an existing session whose tenant is no longer approved", async () => {
    expect(
      await state.config!.callbacks.jwt({
        token: { userId: "test-user", tenantId: "another-test-tenant" },
      }),
    ).toBeNull();
  });
  it("accepts only the explicitly approved tenant claim", async () => {
    expect(
      await state.config!.callbacks.signIn({
        profile: { tid: "approved-test-tenant" },
      }),
    ).toBe(true);
    expect(
      await state.config!.callbacks.signIn({
        profile: { tid: "another-test-tenant" },
      }),
    ).toBe(false);
    expect(await state.config!.callbacks.signIn({ profile: {} })).toBe(false);
  });
  it("does not issue a session token to a disabled user on sign-in", async () => {
    state.disabled = true;
    expect(
      await state.config!.callbacks.jwt({
        token: {},
        profile: {
          sub: "test-subject",
          email: "test@example.test",
          tid: "approved-test-tenant",
        },
      }),
    ).toBeNull();
  });
  it("revokes existing tokens for disabled users", async () => {
    state.disabled = true;
    expect(
      await state.config!.callbacks.jwt({
        token: {
          userId: "test-user",
          role: "admin",
          tenantId: "approved-test-tenant",
        },
      }),
    ).toBeNull();
  });
  it("refreshes permissions from the stored user rather than an old token", async () => {
    const token = await state.config!.callbacks.jwt({
      token: {
        userId: "test-user",
        role: "admin",
        tenantId: "approved-test-tenant",
      },
    });
    expect(token?.role).toBe("viewer");
  });
});
