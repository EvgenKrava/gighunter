import type React from 'react'

export function AppShell({ children }: { user: unknown; onSignIn?: unknown; children: React.ReactNode }) {
  return <>{children}</>
}
