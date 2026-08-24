import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { eq } from "drizzle-orm";
import { getDatabase, hasDatabase } from "@/db/client";
import { users } from "@/db/schema";

export const authConfigured = Boolean(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET && process.env.AUTH_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? "development-only-auth-secret-do-not-deploy",
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [MicrosoftEntraID({
    clientId: process.env.ENTRA_CLIENT_ID ?? "not-configured",
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? "not-configured",
    issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID ?? "common"}/v2.0`,
    authorization: { params: { scope: "openid profile email" } },
  })],
  callbacks: {
    async signIn({ profile }) {
      if (!authConfigured) return process.env.NODE_ENV !== "production";
      const tenantId = typeof profile?.tid === "string" ? profile.tid : undefined;
      return tenantId === process.env.ENTRA_TENANT_ID;
    },
    async jwt({ token, profile }) {
      if (profile && hasDatabase()) {
        const claims = profile as Record<string, unknown>;
        const entraSubject = String(claims.sub ?? token.sub ?? "");
        const email = String(claims.email ?? claims.preferred_username ?? token.email ?? "").trim().toLowerCase();
        if (entraSubject && email) {
          const db = getDatabase();
          const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "adam@version2llc.com").trim().toLowerCase();
          const [user] = await db.insert(users).values({ entraSubject, email, name: typeof profile.name === "string" ? profile.name : undefined, role: email === bootstrapEmail ? "admin" : "viewer", lastSeenAt: new Date() })
            .onConflictDoUpdate({ target: users.entraSubject, set: { email, name: typeof profile.name === "string" ? profile.name : undefined, lastSeenAt: new Date(), updatedAt: new Date() } }).returning();
          token.userId = user.id;
          token.role = user.role;
          token.tenantId = typeof profile.tid === "string" ? profile.tid : undefined;
        }
      } else if (typeof token.userId === "string" && hasDatabase()) {
        const [user] = await getDatabase().select({ id: users.id, role: users.role, disabled: users.disabled }).from(users).where(eq(users.id, token.userId)).limit(1);
        if (!user || user.disabled) return null;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = typeof token.userId === "string" ? token.userId : (token.sub ?? "");
      session.user.role = token.role === "admin" || token.role === "editor" ? token.role : "viewer";
      return session;
    },
  },
  pages: { error: "/auth/error" },
});
