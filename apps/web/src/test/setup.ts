import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
vi.mock('react-oidc-context', async () => {
  const { authState } = await import('./utils')
  return { useAuth: () => authState.current, AuthProvider: ({ children }: { children: unknown }) => children }
})

afterEach(() => cleanup())
