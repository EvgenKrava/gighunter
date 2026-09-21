import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { AppConfig } from '../config'

export const Route = createRootRouteWithContext<{ config: AppConfig }>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <a className="text-brand underline" href="/">Back to start</a>
    </main>
  ),
})
