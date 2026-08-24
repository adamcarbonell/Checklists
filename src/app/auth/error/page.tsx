import Link from "next/link";

export default function AuthErrorPage() {
  return <main className="grid min-h-screen place-items-center bg-[#f3f6f3] p-6"><div className="max-w-md rounded-3xl border border-[#d9e2dc] bg-white p-8 text-center shadow-xl"><h1 className="text-xl font-semibold">Sign-in could not be completed</h1><p className="mt-3 text-sm leading-6 text-slate-600">Use an account from the configured Microsoft Entra tenant. If the problem continues, contact a checklist administrator.</p><Link href="/api/auth/signin" className="mt-6 inline-flex rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white">Try again</Link></div></main>;
}
