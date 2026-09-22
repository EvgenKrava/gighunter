import type { ReactNode } from 'react'
import { Card } from './Card'

/** A grey bone in the shape of the content on its way; size it with className. */
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div aria-hidden className={`rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800 ${className}`} />
)

/** Wraps a page's bones: one announced "Loading" region, the bones themselves stay out of the accessibility tree. */
export const SkeletonPage = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div role="status" aria-busy aria-label="Loading" className={className}>{children}</div>
)

/** A settings/profile card while its data loads: heading bone plus `fields` label + input pairs. */
export const FormCardSkeleton = ({ fields = 2 }: { fields?: number }) => (
  <Card className="space-y-4">
    <Skeleton className="h-6 w-36" />
    {Array.from({ length: fields }, (_, i) => (
      <div key={i} className="space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    ))}
  </Card>
)
