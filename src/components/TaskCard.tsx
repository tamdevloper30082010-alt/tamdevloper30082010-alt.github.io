import { Link } from 'react-router-dom'
import { Badge, Button, Card, cx } from './ui'
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

  return (
    <Card hover className="flex flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Badge className={TASK_TYPE_STYLE[task.task_type]}>{TASK_TYPE_LABEL[task.task_type]}</Badge>
        {task.priority === 'hot' && (
          <Badge className="bg-danger/15 text-danger">🔥 ƯU TIÊN CAO</Badge>
        )}
        {!full && task.remaining <= 3 && (
          <Badge className="bg-warn/15 text-warn">Sắp hết lượt</Badge>
        )}
      </div>

      <Link to={`/nhiem-vu/${task.id}`} className="group">
        <h3 className="text-[15px] leading-snug font-bold group-hover:text-accent">
          {task.title}
        </h3>
        {task.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {task.description}
          </p>
        )}
      </Link>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Thưởng mỗi lượt
          </div>
          <div className="money text-money text-xl leading-tight font-bold">
            {formatVnd(task.price_vnd)}
          </div>
        </div>
        <div className="text-right">
          <div className="money text-sm font-bold">{task.remaining}</div>
          <div className="text-[10px] text-muted">lượt còn lại</div>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/8">
        <div
          className={cx(
            'h-full rounded-full transition-all',
            full ? 'bg-muted/40' : task.remaining <= 3 ? 'bg-warn' : 'bg-accent',
          )}
          style={{ width: `${Math.min(100, (task.taken_count / task.quantity) * 100)}%` }}
        />
      </div>

      {dl && (
        <div className={cx('mt-2.5 text-xs font-semibold', dl.late ? 'text-danger' : 'text-muted')}>
          {dl.late ? '⚠ ' : '⏱ '}
          {dl.text}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {onClaim && (
          <Button
            size="md"
            className="flex-1"
            disabled={!canClaim || full || locked}
            loading={claiming}
            onClick={() => onClaim(task)}
            variant={full || !canClaim ? 'subtle' : 'primary'}
          >
            {claimedByMe ? 'Đã nhận lượt này' : full ? 'Hết lượt' : 'Nhận nhiệm vụ'}
          </Button>
        )}
        <Link
          to={`/nhiem-vu/${task.id}`}
          className="hover:border-line/40 hover:bg-line/5 inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line/20 px-5 text-sm font-semibold transition-all"
        >
          Chi tiết
        </Link>
      </div>
    </Card>
  )
}
