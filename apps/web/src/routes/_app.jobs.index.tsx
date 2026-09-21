import { createFileRoute } from '@tanstack/react-router'

// Placeholder until Task 6 implements the jobs list. Needed now so the pathless
// `_app` layout has at least one child: a childless pathless layout resolves to
// full path "/" in TanStack Router's file-based route generator, which collides
// with the public `routes/index.tsx` landing route and blocks route-tree generation.
export const Route = createFileRoute('/_app/jobs/')({ component: () => null })
