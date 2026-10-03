import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useTheme } from '../hooks/theme'
import { cx, Badge } from './ui'
import { formatVnd } from '../lib/money'
import { supabase } from '../lib/supabase'
import type { Wallet } from '../lib/types'

const WORKER_NAV = [
  { to: '/', label: 'Nhiệm vụ', icon: '◈' },
  { to: '/cong-viec', label: 'Của tôi', icon: '◎' },
  { to: '/rut-tien', label: 'Rút tiền', icon: '⇩' },
  { to: '/vi', label: 'Ví', icon: '◉' },
]

const ADMIN_NAV = [
  { to: '/admin', label: 'Tổng quan', icon: '◈' },
  { to: '/admin/nhiem-vu', label: 'Nhiệm vụ', icon: '▤' },
  { to: '/admin/duyet', label: 'Duyệt', icon: '✓' },
  { to: '/admin/rut-tien', label: 'Rút tiền', icon: '⇩' },
  { to: '/admin/nguoi-dung', label: 'Người', icon: '☺' },
]

function Logo() {
  return (
    <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
      <span className="from-accent to-info grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-sm font-black text-black">
        ⚡
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span className="text-[15px] font-extrabold tracking-tight">Vượt Nhanh</span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
          Sàn nhiệm vụ
        </span>
      </span>
    </NavLink>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label={`Chuyển giao diện ${theme === 'dark' ? 'sáng' : 'tối'}`}
      title={`Giao diện ${theme === 'dark' ? 'tối' : 'sáng'}`}
      className="border-line/12 hover:border-line/30 hover:bg-line/8 grid h-10 w-10 cursor-pointer place-items-center rounded-xl border text-base transition-all"
    >
      {theme === 'dark' ? '☀' : '☾'}
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
      className="border-money/25 bg-money/10 hover:bg-money/15 hidden items-center gap-2 rounded-xl border px-3 py-2 transition-colors sm:flex"
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

  if (!profile) return null
  const initial = (profile.full_name || profile.email || '?').charAt(0).toUpperCase()

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="border-line/12 hover:bg-line/8 grid h-10 w-10 cursor-pointer place-items-center rounded-xl border text-sm font-bold transition-all"
        aria-label="Tài khoản"
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="glass animate-in absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl p-1.5">
            <div className="border-b border-line/10 px-3 py-2.5">
              <div className="truncate text-sm font-bold">
                {profile.full_name || 'Chưa đặt tên'}
              </div>
              <div className="truncate text-xs text-muted">{profile.email}</div>
            </div>
            <div className="px-3 py-2">
              {isAdmin ? (
                <Badge className="bg-money/15 text-money">QUẢN TRỊ VIÊN</Badge>
              ) : (
                <Badge className="bg-info/15 text-info">NGƯỜI NHẬN NHIỆM VỤ</Badge>
              )}
            </div>
            <button
              onClick={async () => {
                setOpen(false)
                await signOut()
                nav('/')
              }}
              className="hover:bg-danger/12 w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-danger transition-colors"
            >
              Đăng xuất
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, isAdmin, profile } = useAuth()
  const links = isAdmin ? ADMIN_NAV : WORKER_NAV

  return (
    <div className="min-h-dvh">
      <div className="aurora" aria-hidden />

      <header className="sticky top-0 z-40 border-b border-line/8 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/' || l.to === '/admin'}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-line/6 hover:text-fg',
                  )
                }
              >
                {l.label}
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
                <a
                  href="/dang-nhap"
                  className="hover:bg-line/8 hidden rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-fg sm:block"
                >
                  Đăng nhập
                </a>
                <a
                  href="/dang-ky"
                  className="bg-accent glow-accent rounded-lg px-4 py-2 text-sm font-bold text-black transition-all hover:brightness-110"
                >
                  Đăng ký
                </a>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 md:pb-12">{children}</main>

      {/* Bottom nav — chỉ hiện trên điện thoại */}
      {session && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/10 bg-bg/90 backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-lg">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/' || l.to === '/admin'}
                className={({ isActive }) =>
                  cx(
                    'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors',
                    isActive ? 'text-accent' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="text-lg leading-none">{l.icon}</span>
                    <span className={isActive ? 'opacity-100' : 'opacity-80'}>{l.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      <footer className="mx-auto max-w-6xl px-4 pt-8 text-center text-xs text-muted">
        <p>
          {profile?.role === 'admin' ? 'Chế độ quản trị' : 'Chế độ người nhận nhiệm vụ'} ·{' '}
          {new Date().getFullYear()} Vượt Nhanh
        </p>
      </footer>
    </div>
  )
}
