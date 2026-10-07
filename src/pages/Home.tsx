import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { TaskCard } from '../components/TaskCard'
import {
  Button,
  Empty,
  Input,
  PillGroup,
  Select,
  SkeletonCard,
} from '../components/ui'
import { CountUp, Reveal, SplitText, useMagnetic } from '../components/animations'
import { supabase, errMessage } from '../lib/supabase'
import { formatNumber, formatVnd } from '../lib/money'
import { TASK_TYPE_LABEL, type Submission, type Task, type TaskType } from '../lib/types'

type Sort = 'new' | 'high' | 'low' | 'slots'

const TASK_TYPES: TaskType[] = ['link', 'other']

const STEPS = [
  {
    n: '01',
    title: 'Chọn nhiệm vụ',
    body: 'Duyệt bảng tin, lọc theo loại và mức thưởng. Mỗi nhiệm vụ hiện rõ số lượt còn trống.',
  },
  {
    n: '02',
    title: 'Nhận lượt & làm',
    body: 'Bấm “Nhận nhiệm vụ” để giữ chỗ. Link cần vượt chỉ hiện sau khi bạn đã nhận.',
  },
  {
    n: '03',
    title: 'Nộp thành quả',
    body: 'Vượt link thì dán link kết quả; nhiệm vụ khác thì chụp ảnh làm bằng chứng.',
  },
  {
    n: '04',
    title: 'Nhận thưởng',
    body: 'Admin duyệt xong là tiền cộng thẳng vào ví. Rút về ngân hàng, thẻ cào hoặc tài khoản game.',
  },
]

export default function Home() {
  const { session, profile } = useAuth()
  const toast = useToast()

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [closedTasks, setClosedTasks] = useState<Task[]>([])
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [taskType, setTaskType] = useState<'' | TaskType>('')
  const [sort, setSort] = useState<Sort>('new')
  // Mặc định chỉ hiện nhiệm vụ còn lượt. Nhiệm vụ đã đóng/đủ người nhận
  // thì không làm được gì nên không nên chiếm chỗ trên bảng tin.
  const [showClosed, setShowClosed] = useState(false)

  const ctaRef = useMagnetic<HTMLAnchorElement>(0.16)

  // Hai view tách sẵn ở database: v_tasks chỉ có nhiệm vụ còn nhận được,
  // v_tasks_closed chỉ có nhiệm vụ đã đủ người nhận. Không lọc ở JavaScript.
  const loadOpen = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('v_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) toast(errMessage(error, 'Không tải được danh sách nhiệm vụ.'), 'err')
      else setOpenTasks((data as Task[]) ?? [])
    } catch {
      // Mạng chết / DNS lỗi… phải tắt skeleton, không để người dùng
      // nhìn khung xương vĩnh viễn vì lời gọi ném exception thay vì trả error.
      toast('Không kết nối được máy chủ. Vui lòng thử lại.', 'err')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadClosed = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('v_tasks_closed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) toast(errMessage(error, 'Không tải được danh sách nhiệm vụ.'), 'err')
      else setClosedTasks((data as Task[]) ?? [])
    } catch {
      toast('Không kết nối được máy chủ. Vui lòng thử lại.', 'err')
    }
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
      toast('Đăng nhập để bắt đầu nhận nhiệm vụ.', 'info')
      return
    }
    setClaiming(t.id)
    const { error } = await supabase.rpc('claim_task', { p_task_id: t.id })
    if (error) {
      toast(errMessage(error), 'err')
    } else {
      toast(`Đã nhận “${t.title}”. Mở Công việc của tôi để lấy link.`, 'ok')
      setMine((s) => new Set(s).add(t.id))
      void loadOpen()
    }
    setClaiming(null)
  }

  const tasks = showClosed ? closedTasks : openTasks

  const filtered = useMemo(() => {
    let out = tasks
    if (taskType) out = out.filter((t) => t.task_type === taskType)
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
  }, [tasks, taskType, q, sort])

  const openCount = openTasks.length
  const totalSlots = openTasks.reduce((s, t) => s + t.remaining, 0)
  const totalPay = openTasks.reduce((s, t) => s + t.price_vnd * t.remaining, 0)
  const avgPay = openCount > 0 ? Math.round(totalPay / Math.max(1, totalSlots)) : 0

  return (
    <div className="space-y-14">
      {/* ══ HERO ══════════════════════════════════════════════ */}
      <section className="relative pt-6 pb-2 sm:pt-12">
        <div className="mx-auto max-w-3xl text-center">
          <span
            className="animate-in glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
            style={{ animationDelay: '50ms' }}
          >
            <span className="bg-accent pulse-ring h-1.5 w-1.5 rounded-full" />
            {openCount > 0
              ? `${formatNumber(openCount)} nhiệm vụ đang chờ người nhận`
              : 'Hệ thống đang sẵn sàng nhận nhiệm vụ mới'}
          </span>

          <h1 className="font-display mt-6 text-[34px] leading-[1.1] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            <SplitText text="Kiếm thu nhập thật" />
            <br className="sm:hidden" />{' '}
            <SplitText text="từ nhiệm vụ hằng ngày" className="text-gradient" perWord={false} />
          </h1>

          <p
            className="animate-in mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base"
            style={{ animationDelay: '220ms' }}
          >
            Mỗi lượt hoàn thành được cộng thẳng vào ví. Nhiệm vụ vượt link thì nộp
            link kết quả, nhiệm vụ khác thì chụp ảnh làm bằng chứng — không cần vốn,
            không cần kinh nghiệm.
          </p>

          {!session && (
            <div
              className="animate-in mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ animationDelay: '320ms' }}
            >
              <Link ref={ctaRef} to="/dang-ky" className="w-full sm:w-auto">
                <Button size="xl" glowRing block>
                  Tạo tài khoản miễn phí
                </Button>
              </Link>
              <Link to="/dang-nhap" className="w-full sm:w-auto">
                <Button size="xl" variant="outline" block>
                  Tôi đã có tài khoản
                </Button>
              </Link>
            </div>
          )}

          {session && profile?.role === 'worker' && (
            <div className="animate-in mt-8" style={{ animationDelay: '320ms' }}>
              <Link to="/cong-viec">
                <Button size="xl" glowRing>
                  Xem công việc của tôi
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* ══ Số liệu tức thời ═══════════════════════════════ */}
        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {[
            { label: 'Nhiệm vụ mở', value: openCount, fmt: formatNumber, tone: 'text-accent' },
            { label: 'Lượt còn trống', value: totalSlots, fmt: formatNumber, tone: 'text-info' },
            {
              label: 'Tổng thưởng',
              value: totalPay,
              fmt: (n: number) => `${formatVnd(n)}`,
              tone: 'text-money',
            },
            { label: 'Thưởng trung bình', value: avgPay, fmt: (n: number) => `${formatVnd(n)}`, tone: 'text-fg' },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 90}>
              <div className="glass card-hover h-full rounded-2xl p-4 text-center sm:p-5">
                <div className={`money text-xl font-extrabold sm:text-2xl ${s.tone}`}>
                  <CountUp value={s.value} format={s.fmt} />
                </div>
                <div className="mt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {s.label}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ CÁCH HOẠT ĐỘNG ════════════════════════════════════ */}
      <section>
        <Reveal className="mb-6 text-center">
          <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Bốn bước để bắt đầu
          </h2>
          <p className="mt-2 text-sm text-muted">
            Không cần kinh nghiệm. Không cần vốn. Chỉ cần tài khoản miễn phí.
          </p>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 100}>
              <div className="glass card-hover group h-full rounded-2xl p-5">
                <div className="font-display text-accent/70 text-3xl font-black transition-transform duration-300 group-hover:scale-110">
                  {s.n}
                </div>
                <h3 className="font-display mt-2 text-base font-bold">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ BẢNG TIN NHIỆM VỤ ═════════════════════════════════ */}
      <section id="bang-tin" className="scroll-mt-24">
        <Reveal className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-tight">
              Bảng tin nhiệm vụ
            </h2>
            <p className="mt-1 text-sm text-muted">
              {loading
                ? 'Đang tải…'
                : showClosed
                  ? `Đang xem ${formatNumber(filtered.length)} nhiệm vụ đã đóng`
                  : `Có ${formatNumber(filtered.length)} nhiệm vụ đang nhận được`}
            </p>
          </div>

          <PillGroup
            value={showClosed ? 'closed' : 'open'}
            onChange={(v) => setShowClosed(v === 'closed')}
            options={[
              { k: 'open', label: 'Đang mở', count: openTasks.length },
              { k: 'closed', label: 'Đã đóng', count: closedTasks.length },
            ]}
          />
        </Reveal>

        {/* Bộ lọc */}
        <Reveal delay={80}>
          <div className="glass mb-5 flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Tìm theo tên hoặc mô tả nhiệm vụ…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="flex-1"
            />
            <PillGroup
              value={taskType}
              onChange={setTaskType}
              options={[
                { k: '' as const, label: 'Tất cả' },
                ...TASK_TYPES.map((t) => ({ k: t, label: TASK_TYPE_LABEL[t] })),
              ]}
            />
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="sm:w-48"
            >
              <option value="new">Mới nhất</option>
              <option value="high">Thưởng cao nhất</option>
              <option value="low">Thưởng thấp nhất</option>
              <option value="slots">Còn nhiều lượt</option>
            </Select>
          </div>
        </Reveal>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            title={showClosed ? 'Chưa có nhiệm vụ nào đã đóng' : 'Chưa có nhiệm vụ nào'}
            hint={
              showClosed
                ? closedTasks.length === 0
                  ? 'Khi nhiệm vụ hết lượt, chúng sẽ xuất hiện ở đây.'
                  : 'Không có nhiệm vụ nào khớp với bộ lọc của bạn.'
                : openTasks.length === 0
                  ? 'Hiện chưa có nhiệm vụ nào đang nhận. Hãy quay lại sau.'
                  : 'Không còn nhiệm vụ nào khớp bộ lọc. Thử xóa từ khoá hoặc đổi loại nhiệm vụ.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t, i) => (
              <div
                key={t.id}
                className="animate-in"
                style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
              >
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
      </section>

      {/* ══ KÊU GỌI ĐĂNG KÝ ═══════════════════════════════════ */}
      {!session && (
        <Reveal>
          <section className="glass-strong spotlight relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-10 sm:py-16">
            <div
              className="from-accent/20 pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent to-accent-2/20"
              aria-hidden
            />
            <div className="relative">
              <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
                Sẵn sàng bắt đầu kiếm thu nhập?
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
                Tạo tài khoản miễn phí, nhận nhiệm vụ đầu tiên và rút thưởng khi
                admin duyệt xong. Không phí đăng ký, không phí ẩn.
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link to="/dang-ky" className="w-full sm:w-auto">
                  <Button size="xl" glowRing block>
                    Tạo tài khoản miễn phí
                  </Button>
                </Link>
                <a href="#bang-tin" className="w-full sm:w-auto">
                  <Button size="xl" variant="outline" block>
                    Xem nhiệm vụ trước
                  </Button>
                </a>
              </div>
            </div>
          </section>
        </Reveal>
      )}
    </div>
  )
}
