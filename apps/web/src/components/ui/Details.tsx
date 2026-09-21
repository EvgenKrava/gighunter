import type { ReactNode } from 'react'
export const Details = ({ summary, children, defaultOpen }: { summary: string; children: ReactNode; defaultOpen?: boolean }) => (
  <details open={defaultOpen} className="group rounded-lg border border-slate-200 dark:border-slate-800">
    <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden">
      <span className="mr-2 transition group-open:rotate-90">▸</span>{summary}
    </summary>
    <div className="px-3 pb-3 text-sm text-slate-600 dark:text-slate-300">{children}</div>
  </details>
)
