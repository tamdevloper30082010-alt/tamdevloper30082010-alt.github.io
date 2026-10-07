import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, PageHeader, Spinner, StatTile } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { supabase, errMessage } from '../../lib/supabase'
import { formatVnd } from '../../lib/money'
import type { AdminStats, AuditEntry } from '../../lib/types'

const ACTION_LABEL: Record<string, string> = {
  bootstrap_admin: 'Khởi tạo quản trị',
  create_task: 'Tạo nhiệm vụ',
  update_task: 'Sửa nhiệm vụ',
  delete_task: 'Xoá nhiệm vụ',
  claim_task: 'Nhận nhiệm vụ',
  submit_result: 'Gửi thành quả',
  approve: 'Duyệt + cộng tiền',
  reject: 'Từ chối',
  release_slot: 'Thu hồi lượt',
  worker_cancel: 'Người nhận bỏ lượt',
  set_role: 'Đổi quyền',
  adjust_balance: 'Điều chỉnh số dư',
  payout: 'Rút tiền',
}

export default function Dashboard() {
  const toast = useToast()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('v_admin_stats').select('*').maybeSingle(),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(25),
    ])
    if (s.error) toast(errMessage(s.error, 'Không tải được thống kê.'), 'err')
    if (a.error) toast(errMessage(a.error, 'Không tải được nhật ký.'), 'err')
    setStats((s.data as AdminStats) ?? null)
    setAudit((a.data as AuditEntry[]) ?? [])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Spinner label="Đang tải…" />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Quản trị"
        icon="◈"
        title="Tổng quan"
        desc="Sức khoẻ hoạt động của sàn trong ngày và 30 ngày gần nhất."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Chờ duyệt" value={stats?.waiting_review ?? 0} tone="money" />
        <StatTile label="Đang làm" value={stats?.in_progress ?? 0} tone="info" />
        <StatTile label="Nhiệm vụ mở" value={stats?.tasks_open ?? 0} />
        <StatTile label="Người nhận" value={stats?.workers ?? 0} />
        <StatTile label="Tiền 24 giờ" value={formatVnd(stats?.paid_24h ?? 0)} tone="money" />
        <StatTile label="Tiền 30 ngày" value={formatVnd(stats?.paid_30d ?? 0)} tone="money" />
      </div>

      {stats && stats.waiting_review > 0 && (
        <Link
          to="/admin/duyet"
          className="border-money/35 bg-money/10 hover:bg-money/16 block rounded-2xl border p-5 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="money text-money text-2xl font-bold">
                {stats.waiting_review}
              </div>
              <div className="mt-0.5 text-sm text-muted">lượt đang chờ bạn duyệt</div>
            </div>
            <span className="text-money text-2xl">→</span>
          </div>
        </Link>
      )}

      <div>
        <h2 className="mb-3 text-lg font-bold">Nhật ký kiểm toán</h2>
        {audit.length === 0 ? (
          <Empty title="Chưa có hoạt động nào" hint="Mọi thao tác tiền sẽ được ghi lại ở đây." />
        ) : (
          <Card className="divide-y divide-line/8 overflow-hidden">
            {audit.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 p-3.5 sm:p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {ACTION_LABEL[e.action] ?? e.action}
                  </div>
                  {typeof e.payload?.note === 'string' && (
                    <div className="mt-0.5 truncate text-xs text-muted">{e.payload.note}</div>
                  )}
                  {typeof e.payload?.amount_vnd === 'number' && (
                    <div className="money mt-0.5 text-xs text-money">
                      {formatVnd(e.payload.amount_vnd)}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  {new Date(e.created_at).toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
