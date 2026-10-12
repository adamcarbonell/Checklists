import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { authConfigured } from "@/auth";
import { hasDatabase } from "@/db/client";
import { loadDefinitions, loadLibrary } from "@/lib/workspace-data";
import { GlobalLibrary } from "@/components/global-library";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ stepId?: string }>;
}) {
  const user = await currentUser();
  if (!user && authConfigured)
    redirect("/api/auth/signin?callbackUrl=/global-library");
  if (!user && process.env.NODE_ENV === "production")
    return <main className="p-8">Authentication setup required.</main>;
  const { stepId } = await searchParams;
  const demo = !hasDatabase() && process.env.NODE_ENV !== "production";
  const [steps, definitions] = hasDatabase()
    ? await Promise.all([loadLibrary(), loadDefinitions()])
    : [[], []];
  return (
    <GlobalLibrary
      initialSteps={steps}
      definitions={definitions}
      selectedStepId={stepId}
      user={user ?? { name: "", email: "", role: "viewer" }}
      demo={demo}
    />
  );
}
