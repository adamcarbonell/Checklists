"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f6f3] p-6">
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8">
        <h1 className="text-xl font-semibold">Workspace unavailable</h1>
        <p className="mt-3 text-sm text-slate-600">
          The workspace could not be loaded. Try again, or contact an
          administrator if the problem continues.
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-xl bg-teal-700 px-4 py-2 text-sm text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
