import { ArrowLeft, BookOpenCheck } from "lucide-react";
import Link from "next/link";

export function AdminShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-[#f3f6f3]">
    <header className="border-b border-[#d9e2dc] bg-[#102d2a] text-white"><div className="mx-auto flex h-20 max-w-6xl items-center gap-4 px-5"><Link href="/" className="grid size-10 place-items-center rounded-xl bg-white/10"><ArrowLeft size={18} /></Link><div className="grid size-9 place-items-center rounded-xl bg-[#b7e454] text-[#17322e]"><BookOpenCheck size={19} /></div><div><div className="text-base font-semibold">{title}</div><div className="text-xs text-white/55">{description}</div></div></div></header>
    <div className="mx-auto max-w-6xl p-5 md:p-8">{children}</div>
  </main>;
}
