import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import { Card, Empty, PageHeader, Spinner, StatTile, cx } from '../components/ui'
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

  const balance = wallet?.balance_vnd ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tài chính"
        icon="◉"
        title="Ví tiền"
        desc="Số dư được tính tự động từ toàn bộ giao dịch trên hệ thống — không thể sửa tay, mọi thay đổi đều có dấu vết."
      />

      <Card
        className={cx(
          'bg-gradient-to-br p-6',
          balance < 0 ? 'border-danger/35 from-danger/12 to-danger/6' : 'from-money/12 to-accent/8 border-money/25',
        )}
      >
        <div className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Số dư hiện tại
        </div>
        <div
          className={cx(
            'money mt-1 text-4xl font-bold',
            balance < 0 ? 'text-danger' : balance > 0 ? 'text-money' : 'text-muted',
          )}
        >
          {formatVnd(balance)}
        </div>
        {balance < 0 ? (
          <div className="mt-3 rounded-xl border border-danger/35 bg-danger/10 p-3.5">
            <div className="text-[11px] font-bold tracking-wider text-danger uppercase">
              ⚠ Bạn đang nợ {formatVnd(Math.abs(balance))}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed font-medium">
              Bạn cần kiếm thêm <b className="money">{formatVnd(Math.abs(balance))}</b> qua
              nhiệm vụ để đưa số dư về 0. Chỉ khi số dư dương bạn mới rút được tiền.
            </p>
            <Link
              to="/"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-danger px-3.5 py-2 text-sm font-bold text-white transition-all hover:brightness-110"
            >
              Đi làm nhiệm vụ bù nợ →
            </Link>
          </div>
        ) : balance === 0 ? (
          <p className="mt-2 text-xs font-semibold text-muted">
            Số dư bằng 0 — rút tiền cần ít nhất 10.000 ₫. Nhận nhiệm vụ để kiếm thêm nhé.
          </p>
        ) : null}
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
        className={cx(
          'block rounded-2xl border p-4 transition-colors',
          balance < 0
            ? 'border-danger/25 bg-danger/8 hover:bg-danger/12'
            : 'border-accent/30 bg-accent/8 hover:bg-accent/14',
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {balance < 0
              ? '⛔ Chưa thể rút — hãy kiếm bù số dư âm trước'
              : '⇩ Rút tiền về ngân hàng hoặc nhận thẻ nạp'}
          </span>
          <span className={balance < 0 ? 'text-danger' : 'text-accent'}>→</span>
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
