import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useEffect } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ── Button ─────────────────────────────────────────────────── */

type Variant = 'primary' | 'money' | 'outline' | 'ghost' | 'danger' | 'subtle'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-black hover:brightness-110 glow-accent sheen font-bold',
  money: 'bg-money text-black hover:brightness-110 glow-money sheen font-bold',
  danger: 'bg-danger text-white hover:brightness-110 font-bold',
  outline: 'border border-line/20 text-fg hover:border-line/40 hover:bg-line/5',
  ghost: 'text-muted hover:text-fg hover:bg-line/5',
  subtle: 'bg-line/8 text-fg hover:bg-line/12 border border-line/10',
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  block?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  const sizes = {
    sm: 'h-9 px-3.5 text-[13px] rounded-lg gap-1.5',
    md: 'h-11 px-5 text-sm rounded-xl gap-2',
    // lg dành cho nút "Nhận nhiệm vụ" trên điện thoại — bấm bằng ngón tay cho dễ
    lg: 'h-14 px-6 text-base rounded-xl gap-2 w-full sm:w-auto',
  }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold',
        'transition-all duration-200 active:scale-[.97]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
    >
      {loading && <span className="spinner !h-3.5 !w-3.5" />}
      {children}
    </button>
  )
}

/* ── Form fields ───────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-fg">
        {label}
        {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

const inputBase =
  'w-full rounded-xl border bg-line/[0.04] px-3.5 py-2.5 text-sm text-fg ' +
  'placeholder:text-muted/60 outline-none transition-all ' +
  'focus:border-accent/60 focus:bg-line/[0.07] focus:ring-2 focus:ring-accent/20'

export function Input({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={cx(inputBase, 'h-11', invalid ? 'border-danger/60' : 'border-line/12', className)}
    />
  )
}

export function Textarea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      className={cx(inputBase, 'resize-y', invalid ? 'border-danger/60' : 'border-line/12', className)}
    />
  )
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...rest}
      className={cx(
        inputBase,
        'h-11 cursor-pointer appearance-none bg-no-repeat pr-9',
        invalid ? 'border-danger/60' : 'border-line/12',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%238b91ac' d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 14px center',
      }}
    >
      {children}
    </select>
  )
}

/* ── Bits ──────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  hover,
}: {
  className?: string
  children: ReactNode
  hover?: boolean
}) {
  return (
    <div className={cx('glass rounded-2xl', hover && 'card-hover', className)}>{children}</div>
  )
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <span className="spinner !h-6 !w-6" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
      <div className="text-3xl opacity-40">◔</div>
      <div className="font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted">{hint}</div>}
      {action}
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone = 'fg',
  sub,
}: {
  label: string
  value: ReactNode
  tone?: 'fg' | 'accent' | 'money' | 'info' | 'danger'
  sub?: string
}) {
  const tones = {
    fg: 'text-fg',
    accent: 'text-accent',
    money: 'text-money',
    info: 'text-info',
    danger: 'text-danger',
  }
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</div>
      <div className={cx('money mt-1.5 text-2xl font-bold', tones[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

/* ── Modal: bottom-sheet trên điện thoại, hộp giữa trên desktop ── */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'animate-in glass relative flex max-h-[92dvh] w-full flex-col overflow-hidden',
          'rounded-t-3xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-line/10 px-5 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-line/8 hover:text-fg"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line/10 px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
