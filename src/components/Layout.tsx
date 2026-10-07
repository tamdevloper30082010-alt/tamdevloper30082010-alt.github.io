import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useTheme } from '../hooks/theme'
import { cx, Badge } from './ui'
import { useMagnetic, useSpotlight } from './animations'
import { formatVnd } from '../lib/money'
import { supabase } from '../lib/supabase'
import type { Wallet } from '../lib/types'

const WORKER_NAV = [
  { to: '/', label: 'Nhiệm vụ', icon: '◈' },
  { to: '/cong-viec', label: 'Công việc', icon: '◎' },
  { to: '/rut-tien', label: 'Rút tiền', icon: '⇩' },
  { to: '/vi', label: 'Ví tiền', icon: '◉' },
]

const ADMIN_NAV = [
  { to: '/admin', label: 'Tổng quan', icon: '◈' },
  { to: '/admin/nhiem-vu', label: 'Nhiệm vụ', icon: '▤' },
  { to: '/admin/duyet', label: 'Duyệt', icon: '✓' },
  { to: '/admin/rut-tien', label: 'Rút tiền', icon: '⇩' },
  { to: '/admin/nguoi-dung', label: 'Người dùng', icon: '☺' },
]

function Logo() {
  return (
    <NavLink to="/" className="group flex shrink-0 items-center gap-2.5">
      <span className="from-accent to-accent-2 relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-sm font-black text-black transition-transform duration-300 group-hover:scale-105">
        ⚡
        <span className="absolute inset-0 rounded-xl ring-1 ring-white/20 ring-inset" />
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span className="font-display text-[15px] font-extrabold tracking-tight">
          Vượt Nhanh
        </span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
          Nền tảng việc làm
        </span>
      </span>
    </NavLink>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      aria-label={`Chuyển giao diện ${dark ? 'sáng' : 'tối'}`}
      title={`Giao diện ${dark ? 'tối' : 'sáng'}`}
      className="border-line/12 hover:border-line/30 hover:bg-line/8 grid h-10 w-10 cursor-pointer place-items-center rounded-xl border text-base transition-all duration-200"
    >
      <span
        className="inline-block transition-transform duration-500"
        style={{ animation: 'spin-slow 0.6s var(--ease-spring)' }}
        key={theme}
      >
        {dark ? '☀' : '☾'}
      </span>
    </button>
  )
}

function BalanceChip() {
  const { session } = useAuth()
  const [bal, setBal] = useState<number | null>(null)

  useEffect(() => {
    if (!session) {
      setBal(null)
      return
    }
    let alive = true
    const load = async () => {
      const { data } = await supabase
        .from('v_wallet')
        .select('balance_vnd')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (alive) setBal((data as Wallet | null)?.balance_vnd ?? 0)
    }
    load()
    const ch = supabase
      .channel('wallet')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, load)
      .subscribe()
    return () => {
      alive = false
      ch.unsubscribe()
    }
  }, [session])

  if (bal === null) return null
  return (
    <NavLink
      to="/vi"
      className="border-money/25 bg-money/10 hover:bg-money/18 hover:border-money/40 hidden items-center gap-2 rounded-xl border px-3.5 py-2 transition-all duration-200 sm:flex"
      title="Số dư hiện có — bấm để mở ví"
    >
      <span className="text-xs">🪙</span>
      <span className="money text-money text-sm font-bold">{formatVnd(bal)}</span>
    </NavLink>
  )
}

function UserMenu() {
  const { profile, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    // Đóng khi bấm ra ngoài hoặc nhấn Esc
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  if (!profile) return null
  const initial = (profile.full_name || profile.email || '?').charAt(0).toUpperCase()

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Tài khoản"
        aria-expanded={open}
        className={cx(
          'from-accent/25 to-accent-2/25 grid h-10 w-10 cursor-pointer place-items-center rounded-xl',
          'bg-gradient-to-br text-sm font-extrabold text-fg transition-all duration-200',
          'hover:from-accent/35 hover:to-accent-2/35',
          open && 'ring-2 ring-accent/50',
        )}
      >
        {initial}
      </button>

      {open && (
        <div className="glass-strong animate-in-scale absolute right-0 z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl p-1.5">
          <div className="border-b border-line/10 px-3 py-2.5">
            <div className="truncate text-sm font-bold">
              {profile.full_name || 'Chưa đặt tên'}
            </div>
            <div className="truncate text-xs text-muted">{profile.email}</div>
          </div>
          <div className="px-3 py-2">
            {isAdmin ? (
              <Badge className="bg-money/15 text-money" dot>
                QUẢN TRỊ VIÊN
              </Badge>
            ) : (
              <Badge className="bg-info/15 text-info" dot>
                NGƯỜI NHẬN NHIỆM VỤ
              </Badge>
            )}
          </div>
          <Link
            to="/cong-viec"
            onClick={() => setOpen(false)}
            className="hover:bg-line/8 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors"
          >
            <span className="text-muted">◎</span> Công việc của tôi
          </Link>
          <button
            onClick={async () => {
              setOpen(false)
              await signOut()
              nav('/')
            }}
            className="hover:bg-danger/12 hover:text-danger flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-muted transition-colors"
          >
            <span>⇥</span> Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, isAdmin, profile } = useAuth()
  const links = isAdmin ? ADMIN_NAV : WORKER_NAV
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const ctaRef = useMagnetic<HTMLAnchorElement>(0.18)

  // Header đục/mờ dần khi cuộn — tín hiệu "đã rời khỏi đầu trang"
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Cuộn lên đầu khi đổi trang
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  const spotlightRef = useSpotlight<HTMLDivElement>()

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="backdrop" aria-hidden>
        <i />
        <b />
        <s />
        <em />
      </div>

      <header
        className={cx(
          'sticky top-0 z-50 transition-all duration-300',
          scrolled
            ? 'glass-strong border-b border-line/8'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />

          <nav className="ml-3 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/' || l.to === '/admin'}
                className={({ isActive }) =>
                  cx(
                    'relative rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-200',
                    isActive ? 'text-accent' : 'text-muted hover:text-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {l.label}
                    {/* Gạch chân trượt — vệt sáng chạy sang mục đang chọn */}
                    {isActive && (
                      <span
                        className="bg-accent absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full"
                        style={{ animation: 'fade-in 0.3s ease both' }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <>
                <BalanceChip />
                <ThemeToggle />
                <UserMenu />
              </>
            ) : (
              <>
                <ThemeToggle />
                <Link
                  to="/dang-nhap"
                  className="hover:bg-line/8 hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-muted transition-colors hover:text-fg sm:block"
                >
                  Đăng nhập
                </Link>
                <Link
                  ref={ctaRef}
                  to="/dang-ky"
                  className="bg-accent glow-accent sheen rounded-xl px-4.5 py-2.5 text-sm font-extrabold text-black transition-all duration-200 hover:brightness-110"
                >
                  Bắt đầu kiếm tiền
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 md:pb-14">
        <div ref={spotlightRef}>{children}</div>
      </main>

      {/* Bottom nav — chỉ hiện trên điện thoại */}
      {session && (
        <nav className="glass-strong fixed inset-x-0 bottom-0 z-50 border-t border-line/10 pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="mx-auto flex max-w-lg">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/' || l.to === '/admin'}
                className={({ isActive }) =>
                  cx(
                    'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition-colors duration-200',
                    isActive ? 'text-accent' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Chấm nhỏ bật lên ở mục đang chọn */}
                    {isActive && (
                      <span
                        className="bg-accent absolute top-1 h-1 w-1 rounded-full"
                        style={{ animation: 'pop 0.35s var(--ease-spring) both' }}
                      />
                    )}
                    <span
                      className="text-lg leading-none transition-transform duration-300"
                      style={isActive ? { transform: 'translateY(-1px) scale(1.1)' } : undefined}
                    >
                      {l.icon}
                    </span>
                    <span>{l.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      <footer className="hairline mt-8">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:items-start">
              <Logo />
              <p className="max-w-xs text-center text-xs leading-relaxed text-muted sm:text-left">
                Nền tảng chia sẻ nhiệm vụ và thanh toán tức thì. Mọi khoản thưởng được
                ghi vào sổ cái và đối soát minh bạch.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
              <Link to="/" className="hover:text-fg transition-colors">
                Nhiệm vụ
              </Link>
              <Link to="/cong-viec" className="hover:text-fg transition-colors">
                Công việc của tôi
              </Link>
              <Link to="/rut-tien" className="hover:text-fg transition-colors">
                Rút tiền
              </Link>
              <Link to="/vi" className="hover:text-fg transition-colors">
                Ví tiền
              </Link>
            </div>
          </div>

          <div className="hairline mt-8 flex flex-col items-center justify-between gap-2 pt-6 text-xs text-muted sm:flex-row">
            <p>
              © {new Date().getFullYear()} Vượt Nhanh — Bảo lưu mọi quyền.
            </p>
            <p>
              {profile?.role === 'admin'
                ? 'Đang ở chế độ quản trị viên'
                : 'Đang ở chế độ người nhận nhiệm vụ'}
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
