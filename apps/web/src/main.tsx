import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { AuthProvider } from 'react-oidc-context'
import { routeTree } from './routeTree.gen'
import { readConfig } from './config'
import { buildOidcConfig } from './auth/oidc'
import { ToastProvider } from './components/Toast'
import './styles.css'

const config = readConfig()
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } })
const router = createRouter({ routeTree, context: { config }, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider {...buildOidcConfig(config)}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
)
