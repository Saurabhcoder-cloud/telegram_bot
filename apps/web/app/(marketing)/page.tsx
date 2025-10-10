import Link from 'next/link';

const steps = [
  'Language selection',
  'Phone verification with OTP',
  'Consent capture',
  'Secure upload (S3 presigned URLs)',
  'OCR with sharp + tesseract.js',
  'Document classification',
  'Field extraction + validation rules',
  'Adaptive AI Q&A intake',
  'Compute refund and benefits',
  'Draft PDF preparation',
  'Stripe checkout',
  'Download center + retention controls'
];

export default function MarketingPage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-6">
        <p className="text-sm uppercase tracking-[0.3em] text-accent">US-first tax assistant</p>
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">File confidently with a Telegram + Web duo.</h1>
        <p className="max-w-2xl text-lg text-slate-200">
          TaxHelp Assistant pairs a Telegram concierge with a secure Next.js portal to guide taxpayers from upload to refund. Built for modern compliance, fast automation, and human handoff when needed.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="https://t.me/your_tax_bot"
            className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-emerald-400"
          >
            Launch Telegram bot
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-slate-600 px-6 py-3 text-base font-semibold text-white transition hover:border-white"
          >
            Explore web console
          </Link>
        </div>
      </section>

      <section className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-lg">
        <h2 className="text-2xl font-semibold text-white">From hello to PDF — the full workflow</h2>
        <p className="text-sm text-slate-300">Every taxpayer goes through the same auditable pipeline to stay compliant.</p>
        <ol className="grid gap-3 text-slate-200 md:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step} className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
              <p className="text-sm font-semibold text-accent">Step {index + 1}</p>
              <p className="text-base text-white">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 rounded-3xl border border-slate-800 bg-slate-900/40 p-8">
        <h2 className="text-2xl font-semibold text-white">Security & compliance guardrails</h2>
        <ul className="grid gap-3 text-slate-200 md:grid-cols-2">
          <li>Signed S3 URLs, 7-day download expiry, delete-on-demand.</li>
          <li>CCPA-ready privacy notices & consent logging.</li>
          <li>Masked PII in logs, OTP-only authentication.</li>
          <li>Stripe Checkout for PCI-safe payments.</li>
        </ul>
      </section>
    </div>
  );
}
