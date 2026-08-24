import { ChecklistWorkspace } from "@/components/checklist-workspace";
import { authConfigured } from "@/auth";
import { currentUser } from "@/lib/access";
import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/workspace-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (authConfigured && !user) redirect("/api/auth/signin?callbackUrl=/");
  if (!authConfigured && process.env.NODE_ENV === "production") {
    return <main className="grid min-h-screen place-items-center p-6"><div className="max-w-lg rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-xl font-semibold">Authentication setup required</h1><p className="mt-3 text-sm leading-6 text-amber-900">Configure the Entra tenant, client credentials, and Auth.js secret in Northflank before opening the application.</p></div></main>;
  }
  return <ChecklistWorkspace initialData={await loadWorkspace()} />;
}
