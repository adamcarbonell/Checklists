import { redirect } from "next/navigation";
import { authConfigured } from "@/auth";
import { signedInPage } from "@/lib/page-access";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string }>;
}) {
  if (!authConfigured && process.env.NODE_ENV === "production")
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="max-w-lg rounded-2xl border bg-amber-50 p-8">
          <h1 className="text-xl font-semibold">
            Authentication setup required
          </h1>
          <p className="mt-3 text-sm">
            Configure Entra and Auth.js in Northflank before using Checklists.
          </p>
        </section>
      </main>
    );
  await signedInPage();
  const { templateId } = await searchParams;
  if (templateId) redirect("/templates/" + encodeURIComponent(templateId));
  redirect("/organizations");
}
