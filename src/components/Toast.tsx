import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'ok' | 'err' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const Ctx = createContext<(text: string, kind?: ToastKind) => void>(() => {})

let seq = 0

const LOOK = {
  ok: {
    ring: 'border-accent/35',
    tint: 'bg-accent/12',
    text: 'text-accent',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity=".35" />
        <path
          d="M8 12.5l2.5 2.5L16 9.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  err: {
    ring: 'border-danger/35',
    tint: 'bg-danger/12',
    text: 'text-danger',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity=".35" />
        <path
          d="M12 7.5v5.5M12 16.4v.2"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  info: {
    ring: 'border-line/15',
    tint: 'bg-line/6',
    text: 'text-info',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity=".35" />
        <path
          d="M12 11v5.5M12 7.6v.2"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq
    setItems((v) => [...v.slice(-3), { id, kind, text }])
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 4600)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2.5 px-4 sm:bottom-6"
        role="region"
        aria-live="polite"
      >
        {items.map((t) => {
          const look = LOOK[t.kind]
          return (
            <div
              key={t.id}
              role="status"
              className={`animate-in-scale glass-strong pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3.5 ${look.ring} ${look.tint}`}
            >
              <span className={`mt-0.5 shrink-0 ${look.text}`}>{look.icon}</span>
              <span className="text-fg text-sm leading-snug font-medium">{t.text}</span>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)
