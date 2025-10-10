import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TaxHelp Assistant',
  description: 'US-first tax assistant with Telegram intake and adaptive web workflows.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-10">
          {children}
        </main>
      </body>
    </html>
  );
}
