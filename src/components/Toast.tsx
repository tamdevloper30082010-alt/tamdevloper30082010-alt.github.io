import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'ok' | 'err' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const Ctx = createContext<(text: string, kind?: ToastKind) => void>(() => {})

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq
    setItems((v) => [...v, { id, kind, text }])
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 4200)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-in pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-xl ${
              t.kind === 'ok'
                ? 'border-accent/40 bg-accent/15 text-accent'
                : t.kind === 'err'
                  ? 'border-danger/40 bg-danger/15 text-danger'
                  : 'border-line/15 bg-panel-solid/90 text-fg'
            }`}
          >
            <span className="mt-px shrink-0">
              {t.kind === 'ok' ? '✓' : t.kind === 'err' ? '✕' : 'ℹ'}
            </span>
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)
