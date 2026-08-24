"use client";

import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";

type Organization = { id: string; itglueId: string; name: string; enabled: boolean; lastSyncStatus: "valid" | "invalid" | "stale" | "pending"; lastSyncedAt: string | Date | null };

export function OrganizationManager({ initial }: { initial: Organization[] }) {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState("");
  const lookup = async () => {
    setMessage("Searching IT Glue…");
    const numeric = /^\d+$/.test(query.trim());
    const response = await fetch("/api/organizations?action=lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(numeric ? { id: query.trim() } : { exactName: query.trim() }) });
    const result = await response.json(); setMatches(response.ok ? result.data : []); setMessage(response.ok ? `${result.data.length} exact result(s)` : "Lookup failed");
  };
  const enable = async (match: { id: string; name: string }) => {
    const response = await fetch("/api/organizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itglueId: match.id, name: match.name }) });
    if (response.ok) { const result = await response.json(); setRows((current) => [...current.filter((row) => row.id !== result.data.id), result.data]); setMatches([]); }
  };
  const sync = async (id: string) => {
    setMessage("Synchronizing selected organization…");
    const response = await fetch(`/api/organizations/${id}/sync`, { method: "POST" });
    setMessage(response.ok ? "Synchronization completed." : "Synchronization failed; the last good values were preserved.");
  };
  return <div className="space-y-5"><section className="rounded-2xl border border-[#d9e2dc] bg-white p-5"><h2 className="text-sm font-semibold">Enable an IT Glue organization</h2><p className="mt-1 text-xs text-slate-500">Lookup uses an exact name or numeric IT Glue ID. It is read-only and returns at most 25 organization records.</p><div className="mt-4 flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} className="mapping-input mt-0 flex-1" placeholder="Exact name or IT Glue ID" /><button onClick={lookup} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-semibold text-white"><Search size={14} /> Lookup</button></div>{matches.map((match) => <div key={match.id} className="mt-3 flex items-center justify-between rounded-xl bg-teal-50 p-3 text-xs"><span><b>{match.name}</b> · ITG {match.id}</span><button onClick={() => enable(match)} className="font-semibold text-teal-800">Enable</button></div>)}<div className="mt-3 text-xs text-slate-400">{message}</div></section>
    <section className="overflow-hidden rounded-2xl border border-[#d9e2dc] bg-white"><div className="border-b border-[#e2e8e3] px-5 py-4 text-sm font-semibold">Enabled organizations</div>{rows.map((row) => <div key={row.id} className="flex items-center gap-4 border-b border-[#edf1ee] px-5 py-4 last:border-0"><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{row.name}</div><div className="mt-1 text-[11px] text-slate-400">IT Glue {row.itglueId} · {row.lastSyncedAt ? `last sync ${new Date(row.lastSyncedAt).toLocaleString()}` : "not yet synchronized"}</div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${row.lastSyncStatus === "valid" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>{row.lastSyncStatus}</span><button onClick={() => sync(row.id)} className="grid size-9 place-items-center rounded-xl border border-[#d8e1dc]" title="Synchronize now"><RefreshCw size={14} /></button></div>)}</section>
  </div>;
}
