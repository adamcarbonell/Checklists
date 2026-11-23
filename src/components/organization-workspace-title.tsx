import { useState } from "react";
import Image from "next/image";
import { organizationPath } from "@/lib/organization-paths";
import { organizationLogoMaxBytes, organizationLogoTypes } from "@/lib/organization-logo-input";
import { Modal, MutationGate } from "./workspace-ui";

export function OrganizationWorkspaceTitle({
  organization, initialLogoVersion, canManageLogo,
}: {
  organization: { id: string; name: string };
  initialLogoVersion: string | null;
  canManageLogo: boolean;
}) {
  const [version, setVersion] = useState(initialLogoVersion);
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gate] = useState(() => new MutationGate());
  const logoPath = `/api${organizationPath(organization.id)}/logo`;

  async function save(image: File | null) {
    if (!gate.enter()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(logoPath, image
        ? { method: "PUT", headers: { "Content-Type": image.type }, body: image }
        : { method: "DELETE" });
      if (response.status === 413) throw new Error("Choose a logo that is 1 MB or smaller.");
      if (response.status === 415) throw new Error("Choose a valid PNG, JPEG, WebP, or GIF image.");
      if (!response.ok) throw new Error("The logo could not be saved. Try again.");
      setVersion(image ? (await response.json()).version : null);
      setEditing(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      gate.leave();
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {version && version !== failedVersion && (
          <Image src={`${logoPath}?v=${version}`} alt="" width={48} height={48}
            className="size-12 shrink-0 rounded-lg object-contain" unoptimized loading="eager"
            onError={() => setFailedVersion(version)} />
        )}
        <h1 className="text-xl font-semibold">{organization.name}</h1>
        {canManageLogo && (
          <button type="button" className="focus-ring rounded-lg border px-2.5 py-1.5 text-xs text-teal-800 hover:bg-teal-50"
            onClick={() => { setFile(null); setError(""); setEditing(true); }}>
            {version ? "Change logo" : "Add logo"}
          </button>
        )}
      </div>
      {editing && (
        <Modal title="Organization logo" onClose={() => { if (!busy) setEditing(false); }}>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            if (file) void save(file);
          }}>
            <label className="block text-sm">
              Logo image
              <input type="file" accept={organizationLogoTypes.join(",")} disabled={busy}
                className="mt-2 block w-full rounded-xl border p-3"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  const issue = !next ? "" : next.size > organizationLogoMaxBytes
                    ? "Choose a logo that is 1 MB or smaller."
                    : !organizationLogoTypes.includes(next.type) || !next.size
                      ? "Choose a valid PNG, JPEG, WebP, or GIF image." : "";
                  setFile(issue ? null : next);
                  setError(issue);
                }} />
            </label>
            <p className="text-sm text-slate-600">Use the same image file as in IT Glue. PNG, JPEG, WebP, or GIF, up to 1 MB.</p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button disabled={!file || busy} className="rounded-xl bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40">
                Save logo
              </button>
              {version && <button type="button" disabled={busy} onClick={() => void save(null)}
                className="rounded-xl border px-4 py-2 text-sm text-red-700 disabled:opacity-40">
                Remove logo
              </button>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
