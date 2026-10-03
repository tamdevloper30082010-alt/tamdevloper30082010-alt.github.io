import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { TaskCard } from '../components/TaskCard'
import { Button, Empty, Input, Select, Spinner, cx } from '../components/ui'
import { supabase, errMessage } from '../lib/supabase'
import { formatNumber } from '../lib/money'
import {
  PLATFORM_LABEL,
  type Platform,
  type Submission,
  type Task,
} from '../lib/types'

type Sort = 'new' | 'high' | 'low' | 'slots'

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'facebook', 'website', 'seo', 'khac']

export default function Home() {
  const { session, profile } = useAuth()
  const toast = useToast()

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [closedTasks, setClosedTasks] = useState<Task[]>([])
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [platform, setPlatform] = useState<'' | Platform>('')
  const [sort, setSort] = useState<Sort>('new')
  // Mặc định chỉ hiện nhiệm vụ còn lượt. Nhiệm vụ đã đóng/đủ người nhận
  // thì không làm được gì nên không nên chiếm chỗ trên bảng tin.
  const [showClosed, setShowClosed] = useState(false)

  // Hai view tách sẵn ở database: v_tasks chỉ có nhiệm vụ còn nhận được,
  // v_tasks_closed chỉ có nhiệm vụ đã đủ người nhận. Không lọc ở JavaScript.
  const loadOpen = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) toast(errMessage(error, 'Không tải được danh sách nhiệm vụ.'), 'err')
    else setOpenTasks((data as Task[]) ?? [])
    setLoading(false)
  }, [toast])

  const loadClosed = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_tasks_closed')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) toast(errMessage(error, 'Không tải được danh sách nhiệm vụ.'), 'err')
    else setClosedTasks((data as Task[]) ?? [])
  }, [toast])

  useEffect(() => {
    void loadOpen()
  }, [loadOpen])

  useEffect(() => {
    if (showClosed) void loadClosed()
  }, [showClosed, loadClosed])

  // Nhiệm vụ mà tôi đang giữ lượt → nút hiện "Đã nhận lượt này"
  useEffect(() => {
    if (!session) {
      setMine(new Set())
      return
    }
    let alive = true
    const fetchMine = async () => {
      const { data } = await supabase
        .from('v_submissions')
        .select('task_id, status')
        .in('status', ['in_progress', 'submitted', 'rejected'])
      if (!alive) return
      setMine(new Set(((data as Pick<Submission, 'task_id' | 'status'>[]) ?? []).map((s) => s.task_id)))
    }
    void fetchMine()
    const ch = supabase
      .channel('mine-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, fetchMine)
      .subscribe()
    return () => {
      alive = false
      ch.unsubscribe()
    }
  }, [session])

  const claim = async (t: Task) => {
    if (!session) {
      toast('Hãy đăng nhập để nhận nhiệm vụ.', 'info')
      return
    }
    setClaiming(t.id)
    const { error } = await supabase.rpc('claim_task', { p_task_id: t.id })
    if (error) {
      toast(errMessage(error), 'err')
    } else {
      toast(`Đã nhận nhiệm vụ “${t.title}”. Mở “Của tôi” để lấy link.`, 'ok')
      setMine((s) => new Set(s).add(t.id))
      void loadOpen()
    }
    setClaiming(null)
  }

  const tasks = showClosed ? closedTasks : openTasks

  const filtered = useMemo(() => {
    let out = tasks
    if (platform) out = out.filter((t) => t.platform === platform)
    if (q.trim()) {
      const k = q.trim().toLowerCase()
      out = out.filter(
        (t) =>
          t.title.toLowerCase().includes(k) ||
          t.description.toLowerCase().includes(k),
      )
    }
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort === 'high') return b.price_vnd - a.price_vnd
      if (sort === 'low') return a.price_vnd - b.price_vnd
      if (sort === 'slots') return b.remaining - a.remaining
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return sorted
  }, [tasks, platform, q, sort])

  const openCount = openTasks.length
  const totalPay = openTasks.reduce((s, t) => s + t.price_vnd * t.remaining, 0)

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="animate-in text-center">
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">
          Nhận nhiệm vụ —{' '}
          <span className="from-accent via-money to-info bg-gradient-to-r bg-clip-text text-transparent">
            kiếm tiền VND
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted sm:text-base">
          Mỗi lượt hoàn thành sẽ được cộng tiền vào ví. Admin duyệt thành quả xong là
          tiền về tài khoản.
        </p>

        {!session && (
          <div className="glass animate-in mx-auto mt-5 flex max-w-md flex-col items-center gap-3 rounded-2xl p-5">
            <p className="text-sm text-muted">
              Bạn chưa đăng nhập. Hãy tạo tài khoản để bắt đầu nhận nhiệm vụ.
            </p>
            <div className="flex w-full gap-2">
              <Link to="/dang-ky" className="flex-1">
                <Button block size="lg">
                  Đăng ký miễn phí
                </Button>
              </Link>
              <Link to="/dang-nhap" className="flex-1">
                <Button block size="lg" variant="outline">
                  Đăng nhập
                </Button>
              </Link>
            </div>
          </div>
        )}

        {openCount > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted">
            <span>
              <b className="money text-fg">{formatNumber(openCount)}</b> nhiệm vụ đang mở
            </span>
            <span className="hidden sm:inline">·</span>
            <span>
              Tổng thưởng khả dụng{' '}
              <b className="money text-money">{formatNumber(totalPay)} ₫</b>
            </span>
          </div>
        )}
      </section>

      {/* Bộ lọc */}
      <section className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Tìm nhiệm vụ…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <Select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as '' | Platform)}
          className="sm:w-44"
        >
          <option value="">Mọi nền tảng</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="sm:w-44"
        >
          <option value="new">Mới nhất</option>
          <option value="high">Thưởng cao nhất</option>
          <option value="low">Thưởng thấp nhất</option>
          <option value="slots">Còn nhiều lượt</option>
        </Select>
        <button
          onClick={() => setShowClosed((v) => !v)}
          className={cx(
            'h-11 shrink-0 cursor-pointer rounded-xl border px-4 text-sm font-semibold whitespace-nowrap transition-all',
            showClosed
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-line/12 text-muted hover:border-line/25 hover:text-fg',
          )}
        >
          {showClosed ? 'Ẩn nhiệm vụ đã đóng' : 'Xem cả nhiệm vụ đã đóng'}
        </button>
      </section>

      {/* Danh sách */}
      {loading ? (
        <Spinner label="Đang tải nhiệm vụ…" />
      ) : filtered.length === 0 ? (
        <Empty
          title="Chưa có nhiệm vụ nào"
          hint={
            showClosed
              ? closedTasks.length === 0
                ? 'Chưa có nhiệm vụ nào đã đóng.'
                : 'Không có nhiệm vụ nào khớp với bộ lọc của bạn.'
              : openTasks.length === 0
                ? 'Hiện chưa có nhiệm vụ nào đang nhận. Hãy quay lại sau.'
              : !showClosed
                ? 'Không còn nhiệm vụ nào đang nhận. Bấm “Xem cả nhiệm vụ đã đóng” để xem nhiệm vụ cũ.'
                : 'Không có nhiệm vụ nào khớp với bộ lọc của bạn.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t, i) => (
            <div key={t.id} className="animate-in" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
              <TaskCard
                task={t}
                canClaim={!!session && profile?.role === 'worker'}
                claimedByMe={mine.has(t.id)}
                claiming={claiming === t.id}
                locked={claiming !== null}
                onClaim={session ? claim : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
