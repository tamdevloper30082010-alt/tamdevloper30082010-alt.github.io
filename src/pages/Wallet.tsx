import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { Card, Empty, Spinner, StatTile, cx } from '../components/ui'
import { supabase, errMessage } from '../lib/supabase'
import { formatVnd } from '../lib/money'
import type { Transaction, Wallet } from '../lib/types'

const TX_LABEL: Record<Transaction['type'], string> = {
  task_reward: 'Thưởng nhiệm vụ',
  payout: 'Rút tiền',
  adjustment: 'Điều chỉnh',
}

const TX_STYLE: Record<Transaction['type'], string> = {
  task_reward: 'text-accent',
  payout: 'text-danger',
  adjustment: 'text-info',
}

export default function WalletPage() {
  const { session } = useAuth()
  const toast = useToast()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!session) return
    const [w, t] = await Promise.all([
      supabase.from('v_wallet').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (w.error) toast(errMessage(w.error, 'Không tải được số dư.'), 'err')
    if (t.error) toast(errMessage(t.error, 'Không tải được lịch sử.'), 'err')
    setWallet((w.data as Wallet) ?? null)
    setTxs((t.data as Transaction[]) ?? [])
    setLoading(false)
  }, [session, toast])

  useEffect(() => {
    void load()
  }, [load])

  if (!session) return <Empty title="Bạn chưa đăng nhập" hint="Đăng nhập để xem ví tiền." />
  if (loading) return <Spinner label="Đang tải ví…" />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Ví tiền</h1>
        <p className="mt-1 text-sm text-muted">
          Số dư được tính từ toàn bộ giao dịch — không có cách nào sửa tay.
        </p>
      </div>

      <Card className="from-money/12 to-accent/8 border-money/25 bg-gradient-to-br p-6">
        <div className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Số dư hiện tại
        </div>
        <div
          className={cx(
            'money mt-1 text-4xl font-bold',
            (wallet?.balance_vnd ?? 0) > 0 ? 'text-money' : 'text-muted',
          )}
        >
          {formatVnd(wallet?.balance_vnd ?? 0)}
        </div>
        {(wallet?.balance_vnd ?? 0) < 0 && (
          <p className="mt-2 text-xs font-semibold text-danger">
            ⚠ Số dư âm — quản trị viên cần điều chỉnh.
          </p>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Tổng đã kiếm" value={formatVnd(wallet?.total_earned_vnd ?? 0)} tone="accent" />
        <StatTile label="Tổng đã rút" value={formatVnd(wallet?.total_paid_vnd ?? 0)} tone="danger" />
        <StatTile
          label="Đang chờ rút"
          value={formatVnd(wallet?.pending_withdraw_vnd ?? 0)}
          tone="money"
        />
        <StatTile label="Số giao dịch" value={wallet?.tx_count ?? 0} />
      </div>

      <Link
        to="/rut-tien"
        className="border-accent/30 bg-accent/8 hover:bg-accent/14 block rounded-2xl border p-4 transition-colors"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">⇩ Rút tiền về ngân hàng hoặc nhận thẻ nạp</span>
          <span className="text-accent">→</span>
        </div>
      </Link>

      <div>
        <h2 className="mb-3 text-lg font-bold">Lịch sử giao dịch</h2>
        {txs.length === 0 ? (
          <Empty title="Chưa có giao dịch nào" hint="Hoàn thành nhiệm vụ được duyệt để có thu nhập." />
        ) : (
          <Card className="divide-y divide-line/8 overflow-hidden">
            {txs.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className={cx('text-sm font-semibold', TX_STYLE[t.type])}>
                    {TX_LABEL[t.type]}
                  </div>
                  {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
                  <div className="mt-0.5 text-xs text-muted">
                    {new Date(t.created_at).toLocaleString('vi-VN')}
                  </div>
                </div>
                <div
                  className={cx(
                    'money shrink-0 text-base font-bold',
                    t.amount_vnd >= 0 ? 'text-accent' : 'text-danger',
                  )}
                >
                  {t.amount_vnd >= 0 ? '+' : '−'}
                  {formatVnd(Math.abs(t.amount_vnd))}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
