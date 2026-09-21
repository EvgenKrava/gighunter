import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrollIntoView; ChatPanel calls it to keep the latest
// message in view. Stub it as a no-op so components can call it unconditionally.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

vi.mock('react-oidc-context', async () => {
  const { authState } = await import('./utils')
  return { useAuth: () => authState.current, AuthProvider: ({ children }: { children: unknown }) => children }
})

afterEach(() => cleanup())
