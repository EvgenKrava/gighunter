import type { ReactNode } from 'react'
export const Card = ({ className = '', children }: { className?: string; children: ReactNode }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>
)
