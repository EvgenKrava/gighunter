import { createFileRoute } from '@tanstack/react-router'

// Placeholder until Task 7 implements the job detail page. Needed now so `Link
// to="/jobs/$platform/$id"` in MatchCard resolves against a registered route.
export const Route = createFileRoute('/_app/jobs/$platform/$id')({ component: () => null })
