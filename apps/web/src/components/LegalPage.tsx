import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Radar } from 'lucide-react'

export const CONTACT_EMAIL = 'oldfromkb@gmail.com'
export const ContactLink = () => <a className="text-brand underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>

/** Public prose page (Terms, Privacy): readable signed out, phone-first line length, plain headings. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-brand"><Radar size={22} /><span className="font-semibold">GigHunter</span></Link>
      <h1 className="mt-6 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated {updated}</p>
      <div className="mt-6 space-y-6 text-slate-700 dark:text-slate-300 [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100 [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <p className="mt-10 text-sm text-slate-500">Questions: <ContactLink /></p>
    </main>
  )
}
