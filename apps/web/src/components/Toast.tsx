import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Kind = 'info' | 'success' | 'error'
interface Toast { id: number; message: string; kind: Kind }
const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((message: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])
  const color = { info: 'bg-slate-800', success: 'bg-emerald-700', error: 'bg-red-700' }
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-4">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm text-white shadow-lg ${color[t.kind]}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx)
