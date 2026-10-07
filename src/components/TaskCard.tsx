import { Link } from 'react-router-dom'
import { Badge, Button, Card, ProgressRing, cx } from './ui'
import { formatVnd } from '../lib/money'
import { TASK_TYPE_LABEL, TASK_TYPE_STYLE, type Task } from '../lib/types'

function deadlineText(d: string | null) {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  if (diff <= 0) return { text: 'Đã quá hạn', late: true }
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return { text: `Còn ${Math.max(1, Math.floor(diff / 60_000))} phút`, late: false }
  if (h < 24) return { text: `Còn ${h} giờ`, late: false }
  return { text: `Còn ${Math.floor(h / 24)} ngày`, late: false }
}

export function TaskCard({
  task,
  onClaim,
  claiming,
  claimedByMe,
  canClaim,
  locked,
}: {
  task: Task
  onClaim?: (t: Task) => void
  claiming?: boolean
  claimedByMe?: boolean
  canClaim: boolean
  locked: boolean
}) {
  const dl = deadlineText(task.deadline_at)
  const full = task.remaining <= 0
  // Phần trăm lượt đã lấy — dùng cho cả vòng tròn lẫn thanh tiến trình
  const takenPct = task.quantity > 0 ? (task.taken_count / task.quantity) * 100 : 0

  return (
    <Card hover spotlight className="group flex h-full flex-col overflow-hidden">
      {/* Viền sáng trôi ở mép trên — chi tiết nhỏ nhưng tạo cảm giác "sống" */}
      <span
        className={cx(
          'via-absolute via-x-5 via:top-0 h-px w-2/3 -translate-y-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100',
          full ? 'via-muted/60' : 'via-accent/70',
        )}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={TASK_TYPE_STYLE[task.task_type]} dot>
          {TASK_TYPE_LABEL[task.task_type]}
        </Badge>
        {task.priority === 'hot' && (
          <Badge className="bg-danger/15 text-danger">🔥 Ưu tiên</Badge>
        )}
        {!full && task.remaining <= 3 && (
          <Badge className="bg-warn/15 text-warn">Sắp hết lượt</Badge>
        )}
      </div>

      <Link to={`/nhiem-vu/${task.id}`} className="group/link mt-3 block">
        <h3 className="font-display text-[15px] leading-snug font-bold transition-colors duration-200 group-hover/link:text-accent">
          {task.title}
        </h3>
        {task.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {task.description}
          </p>
        )}
      </Link>

      {/* Thưởng + vòng đếm lượt */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Thưởng mỗi lượt
          </div>
          <div className="money text-money text-[22px] leading-tight font-extrabold">
            {formatVnd(task.price_vnd)}
          </div>
        </div>

        <ProgressRing value={takenPct} size={54}>
          <div className="text-center leading-none">
            <div className={cx('money text-sm font-extrabold', full && 'text-muted')}>
              {task.remaining}
            </div>
            <div className="mt-0.5 text-[8px] font-semibold tracking-wide text-muted uppercase">
              lượt
            </div>
          </div>
        </ProgressRing>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/8">
        <div
          className={cx(
            'progress h-full rounded-full',
            full ? 'bg-muted/40' : task.remaining <= 3 ? 'bg-warn' : 'bg-accent',
          )}
          style={{ width: `${Math.min(100, takenPct)}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold">
        <span className="money text-muted">
          {task.taken_count}/{task.quantity} lượt đã nhận
        </span>
        {dl && (
          <span className={cx('flex items-center gap-1', dl.late ? 'text-danger' : 'text-muted')}>
            {dl.late ? '⚠' : '⏱'} {dl.text}
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-2 pt-0.5">
        {onClaim && (
          <Button
            size="md"
            className="flex-1"
            disabled={!canClaim || full || locked}
            loading={claiming}
            onClick={() => onClaim(task)}
            variant={full || !canClaim ? 'subtle' : 'primary'}
          >
            {claimedByMe ? '✓ Đã nhận lượt này' : full ? 'Hết lượt' : 'Nhận nhiệm vụ'}
          </Button>
        )}
        <Link
          to={`/nhiem-vu/${task.id}`}
          className="hover:border-accent/40 hover:bg-accent/[0.07] inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line/15 px-4 text-sm font-semibold transition-all duration-200"
        >
          Chi tiết
        </Link>
      </div>
    </Card>
  )
}
