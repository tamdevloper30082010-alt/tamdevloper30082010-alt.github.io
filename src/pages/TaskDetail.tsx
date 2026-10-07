import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, ProgressRing, Skeleton, cx } from '../components/ui'
import { supabase, errMessage } from '../lib/supabase'
import { formatVnd } from '../lib/money'
import { TASK_TYPE_LABEL, TASK_TYPE_STYLE, type Task } from '../lib/types'

export default function TaskDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const { session, profile } = useAuth()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [held, setHeld] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const { data, error } = await supabase.from('v_tasks').select('*').eq('id', id).maybeSingle()
    if (error) return toast(errMessage(error, 'Không tải được nhiệm vụ.'), 'err')
    setTask((data as Task) ?? null)
    setLoading(false)

    if (session) {
      const { data: mine } = await supabase
        .from('v_submissions')
        .select('id')
        .eq('task_id', id)
        .in('status', ['in_progress', 'submitted', 'rejected'])
        .limit(1)
      setHeld(!!mine?.length)
    }
  }, [id, session, toast])

  useEffect(() => {
    void load()
  }, [load])

  const claim = async () => {
    if (!task) return
    if (!session) {
      toast('Đăng nhập để bắt đầu nhận nhiệm vụ.', 'info')
      nav('/dang-nhap')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('claim_task', { p_task_id: task.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã nhận nhiệm vụ! Mở Công việc của tôi để lấy link.', 'ok')
    nav('/cong-viec')
  }

  if (loading)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-32" />
        <Card className="space-y-4 p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="grid grid-cols-3 gap-3 pt-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </Card>
      </div>
    )

  if (!task)
    return (
      <Card className="mx-auto max-w-md p-10 text-center">
        <div className="float mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line/10 bg-line/5 text-2xl text-muted">
          ◔
        </div>
        <p className="font-display mt-4 text-lg font-bold">Không tìm thấy nhiệm vụ này</p>
        <p className="mt-1.5 text-sm text-muted">
          Có thể nhiệm vụ đã bị gỡ khỏi bảng tin hoặc đường dẫn không đúng.
        </p>
        <Link to="/" className="text-accent mt-5 inline-block text-sm font-semibold hover:underline">
          ← Về bảng tin nhiệm vụ
        </Link>
      </Card>
    )

  const full = task.remaining <= 0
  const isAdmin = profile?.role === 'admin'
  const mineTask = task.created_by === profile?.id
  const takenPct = task.quantity > 0 ? (task.taken_count / task.quantity) * 100 : 0

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to="/"
        className="text-muted hover:text-fg inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
      >
        ← Tất cả nhiệm vụ
      </Link>

      <Card className="animate-in-scale overflow-hidden p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={TASK_TYPE_STYLE[task.task_type]} dot>
            {TASK_TYPE_LABEL[task.task_type]}
          </Badge>
          {task.priority === 'hot' && <Badge className="bg-danger/15 text-danger">🔥 Ưu tiên cao</Badge>}
          {full && <Badge className="bg-muted/15 text-muted">Đã hết lượt</Badge>}
        </div>

        <h1 className="font-display mt-3.5 text-xl leading-snug font-extrabold tracking-tight sm:text-3xl">
          {task.title}
        </h1>

        {task.description && (
          <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-muted sm:text-[15px]">
            {task.description}
          </p>
        )}

        {/* Số liệu nhiệm vụ */}
        <div className="mt-7 grid grid-cols-3 gap-3">
          <div className="glass card-hover rounded-2xl p-4 text-center">
            <div className="money text-money text-lg font-extrabold sm:text-xl">
              {formatVnd(task.price_vnd)}
            </div>
            <div className="mt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              mỗi lượt
            </div>
          </div>
          <div className="glass card-hover rounded-2xl p-4 text-center">
            <div className="money text-lg font-extrabold sm:text-xl">{task.remaining}</div>
            <div className="mt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              còn lại
            </div>
          </div>
          <div className="glass card-hover rounded-2xl p-4 text-center">
            <div className="money text-lg font-extrabold sm:text-xl">{task.quantity}</div>
            <div className="mt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              tổng lượt
            </div>
          </div>
        </div>

        {/* Tiến trình đã lấy */}
        <div className="mt-4 flex items-center gap-3">
          <ProgressRing value={takenPct} size={44} stroke={4}>
            <span className="money text-[11px] font-bold">
              {Math.round(takenPct)}%
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              {task.taken_count} trên {task.quantity} lượt đã có người nhận
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/8">
              <div
                className={cx(
                  'progress h-full rounded-full',
                  full ? 'bg-muted/40' : 'bg-accent',
                )}
                style={{ width: `${Math.min(100, takenPct)}%` }}
              />
            </div>
          </div>
        </div>

        {task.deadline_at && (
          <p
            className={cx(
              'mt-5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold',
              new Date(task.deadline_at).getTime() < Date.now()
                ? 'border-danger/30 bg-danger/10 text-danger'
                : 'border-line/10 bg-line/[0.04] text-muted',
            )}
          >
            ⏱ Hạn nộp: {new Date(task.deadline_at).toLocaleString('vi-VN')}
          </p>
        )}

        {/* Hành động */}
        <div className="mt-7">
          {isAdmin ? (
            <div className="rounded-xl border border-line/12 bg-line/5 p-4 text-sm text-muted">
              Đây là tài khoản quản trị. Mở{' '}
              <Link to="/admin/duyet" className="text-accent font-semibold hover:underline">
                hàng đợi duyệt
              </Link>{' '}
              để xử lý.
            </div>
          ) : mineTask ? (
            <div className="rounded-xl border border-line/12 bg-line/5 p-4 text-sm text-muted">
              Đây là nhiệm vụ bạn tự tạo nên không thể tự nhận.
            </div>
          ) : held ? (
            <div className="border-accent/30 bg-accent/8 rounded-xl border p-4 text-sm text-accent">
              ✓ Bạn đang giữ lượt của nhiệm vụ này.{' '}
              <Link to="/cong-viec" className="font-semibold underline">
                Đi tới Công việc của tôi
              </Link>
            </div>
          ) : (
            <Button block size="lg" disabled={full} loading={busy} onClick={claim} glowRing>
              {session
                ? full
                  ? 'Đã hết lượt'
                  : 'Nhận nhiệm vụ này'
                : 'Đăng nhập để nhận nhiệm vụ'}
            </Button>
          )}
          {!session && (
            <p className="mt-2.5 text-center text-xs text-muted">
              {task.task_type === 'link'
                ? 'Link cần vượt chỉ hiện sau khi bạn đã nhận nhiệm vụ.'
                : 'Ảnh thành quả chỉ nộp được sau khi bạn đã nhận nhiệm vụ.'}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
