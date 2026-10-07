import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useEffect, useId } from 'react'
import { useRipple, useSpotlight } from './animations'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ── Button ─────────────────────────────────────────────────── */

type Variant = 'primary' | 'money' | 'outline' | 'ghost' | 'danger' | 'subtle'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-black hover:brightness-110 glow-accent sheen font-extrabold border border-accent/50',
  money: 'bg-money text-black hover:brightness-110 glow-money sheen font-extrabold border border-money/50',
  danger: 'bg-danger text-white hover:brightness-110 font-bold border border-danger/50',
  outline: 'border border-line/15 text-fg hover:border-accent/45 hover:bg-accent/[0.07]',
  ghost: 'text-muted hover:text-fg hover:bg-line/8',
  subtle: 'bg-line/8 text-fg hover:bg-line/14 border border-line/10 hover:border-line/20',
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg' | 'xl'
  loading?: boolean
  block?: boolean
  /** Viền sáng chạy vòng quanh khi rê — dành cho CTA chính */
  glowRing?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  block,
  glowRing,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  const ripple = useRipple()
  const sizes = {
    sm: 'h-9 px-3.5 text-[13px] rounded-xl gap-1.5',
    md: 'h-11 px-5 text-sm rounded-xl gap-2',
    // lg dành cho nút "Nhận nhiệm vụ" trên điện thoại — bấm bằng ngón tay cho dễ
    lg: 'h-13 px-6 text-[15px] rounded-2xl gap-2 w-full sm:w-auto',
    xl: 'h-14 px-7 text-base rounded-2xl gap-2.5',
  }
  return (
    <button
      {...rest}
      onClick={(e) => {
        ripple(e)
        rest.onClick?.(e)
      }}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden font-semibold',
        'transition-all duration-200 active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        sizes[size],
        glowRing && 'ring-anim',
        block && 'w-full',
        className,
      )}
    >
      {loading && <span className="spinner !h-3.5 !w-3.5" />}
      <span className="relative z-10 inline-flex items-center gap-[inherit]">{children}</span>
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
  htmlFor,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  required?: boolean
  htmlFor?: string
}) {
  return (
    <div className="block">
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-fg"
      >
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <span className="animate-in-left mt-1.5 block text-xs font-medium text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>
      ) : null}
    </div>
  )
}

const inputBase =
  'w-full rounded-xl border bg-line/[0.035] px-3.5 py-2.5 text-sm text-fg ' +
  'placeholder:text-muted/55 outline-none transition-all duration-200 ' +
  'focus:border-accent/60 focus:bg-line/[0.06] focus:ring-4 focus:ring-accent/12 ' +
  'hover:border-line/20'

export function Input({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={cx(
        inputBase,
        'h-11',
        invalid ? 'border-danger/60' : 'border-line/12',
        className,
      )}
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
      className={cx(
        inputBase,
        'resize-y',
        invalid ? 'border-danger/60' : 'border-line/12',
        className,
      )}
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

/* ── Tiêu đề trang ─────────────────────────────────────────────
   Một dạng cho mọi trang: eyebrow (nhãn nhỏ) + tiêu đề + mô tả +
   hành động bên phải. Nhất quán giữa trang người dùng và trang
   quản trị, đổi nội dung là đủ. */
export function PageHeader({
  eyebrow,
  title,
  desc,
  action,
  icon,
}: {
  eyebrow?: string
  title: string
  desc?: string
  action?: ReactNode
  icon?: string
}) {
  return (
    <div className="animate-in flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-accent text-[11px] font-bold tracking-widest uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display mt-1 flex items-center gap-2.5 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {icon && <span className="text-xl sm:text-2xl">{icon}</span>}
          {title}
        </h1>
        {desc && <p className="mt-1.5 max-w-2xl text-sm text-muted">{desc}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function Card({
  className,
  children,
  hover,
  spotlight,
}: {
  className?: string
  children: ReactNode
  hover?: boolean
  /** Ánh sáng bám theo con trỏ */
  spotlight?: boolean
}) {
  const ref = useSpotlight<HTMLDivElement>()
  return (
    <div
      ref={spotlight ? ref : undefined}
      className={cx(
        'glass rounded-2xl',
        hover && 'card-hover',
        spotlight && 'spotlight',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Badge({
  className,
  children,
  dot,
}: {
  className?: string
  children: ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-1',
        'text-[11px] font-bold tracking-wide',
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Nhóm nút lọc dạng pill — thay cho select thô khi chỉ có 2–4 lựa chọn */
export function PillGroup<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { k: T; label: string; count?: number }[]
  className?: string
}) {
  return (
    <div
      className={cx(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line/10 bg-line/[0.04] p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.k === value
        return (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            className={cx(
              'relative shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-all duration-200',
              active
                ? 'bg-accent text-black shadow-[0_6px_18px_-8px_rgb(var(--c-accent)/0.8)]'
                : 'text-muted hover:bg-line/8 hover:text-fg',
            )}
          >
            {o.label}
            {o.count ? (
              <span
                className={cx(
                  'money ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-black/20' : 'bg-line/10',
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Vòng tròn tiến độ bằng SVG — dùng cho "còn lượt" */
export function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  className,
  children,
}: {
  /** 0–100 */
  value: number
  size?: number
  stroke?: number
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const tone = pct > 66 ? 'text-accent' : pct > 33 ? 'text-warn' : 'text-danger'
  const strokeColor = pct > 66 ? 'var(--c-accent)' : pct > 33 ? 'var(--c-warn)' : 'var(--c-danger)'

  return (
    <div
      className={cx('relative grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={strokeColor} />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-line/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#rg-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          style={{ transition: 'stroke-dashoffset 0.9s var(--ease-out-expo)' }}
        />
      </svg>
      <div className={cx('absolute inset-0 grid place-items-center', tone)}>{children}</div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <span className="spinner !h-7 !w-7" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

/** Khung xương lúc đang tải — giống hình dạng nội dung thật nên không "nhảy" layout */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />
}

export function SkeletonCard() {
  return (
    <div className="glass space-y-3.5 rounded-2xl p-5">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
      <div className="flex items-end justify-between pt-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-5 w-12" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-24" />
      </div>
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
      <div className="float grid h-14 w-14 place-items-center rounded-2xl border border-line/10 bg-line/5 text-2xl text-muted">
        ◔
      </div>
      <div className="font-display text-base font-bold">{title}</div>
      {hint && <div className="max-w-sm text-sm leading-relaxed text-muted">{hint}</div>}
      {action}
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone = 'fg',
  sub,
  icon,
}: {
  label: string
  value: ReactNode
  tone?: 'fg' | 'accent' | 'money' | 'info' | 'danger'
  sub?: string
  icon?: ReactNode
}) {
  const tones = {
    fg: 'text-fg',
    accent: 'text-accent',
    money: 'text-money',
    info: 'text-info',
    danger: 'text-danger',
  }
  return (
    <div className="glass spotlight card-hover group relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          {label}
        </div>
        {icon && (
          <span className="text-base text-muted/70 transition-transform duration-300 group-hover:scale-110">
            {icon}
          </span>
        )}
      </div>
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
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
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
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{ animation: 'fade-in 0.25s ease both' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'glass-strong animate-in-scale relative flex max-h-[92dvh] w-full flex-col overflow-hidden',
          'rounded-t-3xl sm:rounded-3xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/10 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-display truncate text-base font-bold">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="hover:bg-line/10 cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:text-fg"
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
