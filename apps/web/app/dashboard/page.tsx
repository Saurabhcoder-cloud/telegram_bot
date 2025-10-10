import Link from 'next/link';

const checklist = [
  'Verify consent + phone OTP status',
  'Review uploads & OCR extraction',
  'Complete missing items via Adaptive Q&A',
  'Compute refund + owed taxes',
  'Collect payment and release PDF'
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold text-white">Operator console</h1>
        <p className="text-sm text-slate-300">
          Monitor each return as it progresses through the automation pipeline. Manual overrides and support escalations stay audit-ready.
        </p>
        <Link
          href="/api/forms/render"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-white hover:border-white"
        >
          Render sample PDF
        </Link>
      </header>

      <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold text-white">Automation checklist</h2>
        <ul className="grid gap-2 text-sm text-slate-200 md:grid-cols-2">
          {checklist.map((item) => (
            <li key={item} className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
