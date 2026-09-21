import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
vi.mock('react-oidc-context', async () => {
  const { authState } = await import('./utils')
  return { useAuth: () => authState.current, AuthProvider: ({ children }: { children: unknown }) => children }
})
