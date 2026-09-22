import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrollIntoView; ChatPanel calls it to keep the latest
// message in view. Stub it as a no-op so components can call it unconditionally.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
// Same for window.scrollTo, which the router's scroll restoration calls after each navigation.
window.scrollTo = () => {}
// Node ≥ 25 ships an experimental `localStorage` global that reads as undefined without
// --localstorage-file, and its presence stops vitest's jsdom environment from installing the real one.
// The oidc userStore lives there, so give tests an in-memory Storage.
if (typeof globalThis.localStorage === 'undefined') {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() { return data.size },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

vi.mock('react-oidc-context', async () => {
  const { authState } = await import('./utils')
  return { useAuth: () => authState.current, AuthProvider: ({ children }: { children: unknown }) => children }
})

afterEach(() => cleanup())
