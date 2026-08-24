import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; role: "admin" | "editor" | "viewer" };
  }
}

declare module "next-auth/jwt" {
  interface JWT { userId?: string; role?: "admin" | "editor" | "viewer"; tenantId?: string }
}
