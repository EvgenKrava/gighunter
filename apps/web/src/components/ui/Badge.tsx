import type { ReactNode } from 'react'
import type { BadgeTone } from '../../lib/format'
const tones: Record<BadgeTone, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  brand: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
}
export const Badge = ({ tone, children, className = '' }: { tone: BadgeTone; children: ReactNode; className?: string }) => (
  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-medium ${tones[tone]} ${className}`}>{children}</span>
)
