import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Spinner, cx } from '../components/ui'
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
      toast('Hãy đăng nhập trước khi nhận nhiệm vụ.', 'info')
      nav('/dang-nhap')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('claim_task', { p_task_id: task.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã nhận nhiệm vụ! Mở “Của tôi” để lấy link.', 'ok')
    nav('/cong-viec')
  }

  if (loading) return <Spinner label="Đang tải…" />
  if (!task)
    return (
      <Card className="p-10 text-center">
        <p className="font-semibold">Không tìm thấy nhiệm vụ này.</p>
        <Link to="/" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
          ← Về trang chủ
        </Link>
      </Card>
    )

  const full = task.remaining <= 0
  const isAdmin = profile?.role === 'admin'
  const mineTask = task.created_by === profile?.id

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/" className="inline-block text-sm font-semibold text-muted hover:text-fg">
        ← Tất cả nhiệm vụ
      </Link>

      <Card className="p-6">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge className={TASK_TYPE_STYLE[task.task_type]}>{TASK_TYPE_LABEL[task.task_type]}</Badge>
          {task.priority === 'hot' && <Badge className="bg-danger/15 text-danger">🔥 ƯU TIÊN CAO</Badge>}
          {full && <Badge className="bg-muted/15 text-muted">ĐÃ HẾT LƯỢT</Badge>}
        </div>

        <h1 className="text-xl leading-snug font-extrabold tracking-tight sm:text-2xl">
          {task.title}
        </h1>

        {task.description && (
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted">
            {task.description}
          </p>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="glass rounded-xl p-3.5 text-center">
            <div className="money text-money text-lg font-bold">{formatVnd(task.price_vnd)}</div>
            <div className="mt-0.5 text-[11px] text-muted">mỗi lượt</div>
          </div>
          <div className="glass rounded-xl p-3.5 text-center">
            <div className="money text-lg font-bold">{task.remaining}</div>
            <div className="mt-0.5 text-[11px] text-muted">còn lại</div>
          </div>
          <div className="glass rounded-xl p-3.5 text-center">
            <div className="money text-lg font-bold">{task.quantity}</div>
            <div className="mt-0.5 text-[11px] text-muted">tổng lượt</div>
          </div>
        </div>

        {task.deadline_at && (
          <p
            className={cx(
              'mt-4 text-sm font-semibold',
              new Date(task.deadline_at).getTime() < Date.now() ? 'text-danger' : 'text-muted',
            )}
          >
            ⏱ Hạn nộp: {new Date(task.deadline_at).toLocaleString('vi-VN')}
          </p>
        )}

        <div className="mt-6">
          {isAdmin ? (
            <div className="rounded-xl border border-line/12 bg-line/5 p-4 text-sm text-muted">
              Đây là tài khoản quản trị. Mở{' '}
              <Link to="/admin/duyet" className="font-semibold text-accent hover:underline">
                hàng đợi duyệt
              </Link>{' '}
              để xử lý.
            </div>
          ) : mineTask ? (
            <div className="rounded-xl border border-line/12 bg-line/5 p-4 text-sm text-muted">
              Đây là nhiệm vụ bạn tự tạo nên không thể tự nhận.
            </div>
          ) : held ? (
            <div className="rounded-xl border border-accent/30 bg-accent/8 p-4 text-sm text-accent">
              ✓ Bạn đang giữ lượt của nhiệm vụ này.{' '}
              <Link to="/cong-viec" className="font-semibold underline">
                Đi tới “Nhiệm vụ của tôi”
              </Link>
            </div>
          ) : (
            <Button block size="lg" disabled={full} loading={busy} onClick={claim}>
              {session
                ? full
                  ? 'Đã hết lượt'
                  : 'Nhận nhiệm vụ'
                : 'Đăng nhập để nhận nhiệm vụ'}
            </Button>
          )}
          {!session && (
            <p className="mt-2.5 text-center text-xs text-muted">
              {task.task_type === 'link'
                ? 'Link chỉ hiện sau khi bạn nhận nhiệm vụ.'
                : 'Ảnh thành quả chỉ nộp được sau khi bạn nhận nhiệm vụ.'}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
