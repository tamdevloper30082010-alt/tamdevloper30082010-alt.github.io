import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/auth'
import { useToast } from '../../components/Toast'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
  cx,
} from '../../components/ui'
import { supabase, errMessage } from '../../lib/supabase'
import { formatVnd } from '../../lib/money'
import {
  METHOD_LABEL,
  WITHDRAW_STATUS_LABEL,
  WITHDRAW_STATUS_STYLE,
  type Wallet,
  type WithdrawStatus,
  type Withdrawal,
} from '../../lib/types'

type Filter = WithdrawStatus | 'all'

const FILTERS: { k: Filter; label: string }[] = [
  { k: 'pending', label: 'Đang chờ' },
  { k: 'processing', label: 'Đang xử lý' },
  { k: 'approved', label: 'Đã hoàn thành' },
  { k: 'rejected', label: 'Bị từ chối' },
  { k: 'all', label: 'Tất cả' },
]

export default function AdminWithdrawals() {
  const { profile: me } = useAuth()
  const toast = useToast()

  const [rows, setRows] = useState<Withdrawal[]>([])
  const [wallets, setWallets] = useState<Record<string, Wallet>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')

  const [rejecting, setRejecting] = useState<Withdrawal | null>(null)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState('')

  // Giao thẻ cào: bắt buộc nhập mã mới đánh dấu hoàn thành
  const [delivering, setDelivering] = useState<Withdrawal | null>(null)
  const [cardCode, setCardCode] = useState('')
  const [cardSerial, setCardSerial] = useState('')
  const [codeErr, setCodeErr] = useState('')

  const load = useCallback(async () => {
    const [r, w] = await Promise.all([
      supabase.from('v_withdrawals').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('v_wallet').select('*').limit(500),
    ])
    if (r.error) return toast(errMessage(r.error, 'Không tải được yêu cầu rút tiền.'), 'err')
    setRows((r.data as Withdrawal[]) ?? [])
    setWallets(Object.fromEntries(((w.data as Wallet[]) ?? []).map((x) => [x.user_id, x])))
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (w: Withdrawal, status: 'processing' | 'approved', note = '') => {
    setBusy(w.id)
    const { error } = await supabase.rpc('admin_review_withdrawal', {
      p_id: w.id,
      p_status: status,
      p_note: note,
    })
    setBusy(null)
    if (error) return toast(errMessage(error), 'err')
    toast(status === 'approved' ? 'Đã đánh dấu hoàn thành.' : 'Đã chuyển sang đang xử lý.', 'ok')
    void load()
  }

  const doReject = async () => {
    if (!rejecting) return
    if (reason.trim().length < 3) return setReasonErr('Vui lòng nêu lý do (tối thiểu 3 ký tự).')
    setBusy(rejecting.id)
    const { error } = await supabase.rpc('admin_review_withdrawal', {
      p_id: rejecting.id,
      p_status: 'rejected',
      p_note: reason.trim(),
    })
    setBusy(null)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã từ chối. Số tiền đã hoàn lại ví người nhận.', 'ok')
    setRejecting(null)
    setReason('')
    setReasonErr('')
    void load()
  }

  const doDeliver = async () => {
    if (!delivering) return
    if (cardCode.trim().length < 6) return setCodeErr('Mã thẻ phải có ít nhất 6 ký tự.')
    setBusy(delivering.id)
    const { error } = await supabase.rpc('admin_deliver_card', {
      p_id: delivering.id,
      p_code: cardCode.trim(),
      p_serial: cardSerial.trim(),
      p_note: 'Đã gửi mã thẻ cào',
    })
    setBusy(null)
    if (error) return setCodeErr(errMessage(error))
    toast('Đã giao thẻ. Người nhận sẽ thấy mã trong yêu cầu của họ.', 'ok')
    setDelivering(null)
    setCardCode('')
    setCardSerial('')
    setCodeErr('')
    void load()
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1))
    return c
  }, [rows])

  const list = filter === 'all' ? rows : rows.filter((r) => r.status === filter)

  if (loading) return <Spinner label="Đang tải yêu cầu rút tiền…" />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Yêu cầu rút tiền</h1>
        <p className="mt-1 text-sm text-muted">
          Tiền đã trừ khỏi ví người nhận ngay khi họ gửi yêu cầu. Từ chối sẽ hoàn lại.
        </p>
      </div>

      {counts.pending > 0 && filter !== 'pending' && (
        <button
          onClick={() => setFilter('pending')}
          className="border-money/35 bg-money/10 hover:bg-money/16 block w-full cursor-pointer rounded-2xl border p-4 text-left transition-colors"
        >
          <div className="money text-money text-2xl font-bold">{counts.pending}</div>
          <div className="mt-0.5 text-sm text-muted">yêu cầu đang chờ bạn xử lý →</div>
        </button>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={cx(
              'shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-all',
              filter === f.k ? 'bg-accent text-black' : 'text-muted hover:bg-line/8 hover:text-fg',
            )}
          >
            {f.label}
            {counts[f.k] ? (
              <span
                className={cx(
                  'money ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  filter === f.k ? 'bg-black/20' : 'bg-line/10',
                )}
              >
                {counts[f.k]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty title="Không có yêu cầu nào" hint="Chọn bộ lọc khác để xem lịch sử." />
      ) : (
        <div className="space-y-3">
          {list.map((w) => {
            const isSelf = w.user_id === me?.id
            const open = w.status === 'pending' || w.status === 'processing'
            return (
              <Card key={w.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className="bg-line/10 text-muted">{METHOD_LABEL[w.method]}</Badge>
                      <Badge className={WITHDRAW_STATUS_STYLE[w.status]}>
                        {WITHDRAW_STATUS_LABEL[w.status]}
                      </Badge>
                      {isSelf && <Badge className="bg-danger/15 text-danger">CỦA BẠN</Badge>}
                    </div>
                    <div className="mt-1.5 truncate text-sm font-bold">
                      {w.user_name || w.user_email}
                    </div>
                    <div className="truncate text-xs text-muted">{w.user_email}</div>
                  </div>
                  <div className="text-right">
                    <div className="money text-money text-xl font-bold">
                      {formatVnd(w.amount_vnd)}
                    </div>
                    <div className="text-[10px] text-muted">
                      {new Date(w.created_at).toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-line/12 bg-line/[0.04] p-3.5">
                  {w.method === 'bank' && (
                    <dl className="space-y-1.5 text-[13px]">
                      <Line k="Ngân hàng" v={w.bank_code} />
                      <Line k="Chủ tài khoản" v={w.bank_holder} />
                      <Line k="Số tài khoản" v={w.bank_number} mono />
                    </dl>
                  )}
                  {w.method === 'game' && (
                    <dl className="space-y-1.5 text-[13px]">
                      <Line k="Game" v={w.game_platform} />
                      <Line k="ID tài khoản" v={w.game_account_id} mono strong />
                    </dl>
                  )}
                  {w.method === 'card' && (
                    <dl className="space-y-1.5 text-[13px]">
                      <Line k="Thẻ cào" v={w.card_brand} />
                      {w.card_code && <Line k="Mã đã giao" v={w.card_code} mono strong />}
                    </dl>
                  )}
                </div>

                {w.note && <p className="mt-2.5 text-[13px] text-muted">“{w.note}”</p>}
                {w.admin_note && (
                  <p
                    className={cx(
                      'mt-2 text-[13px] font-medium',
                      w.status === 'approved' ? 'text-accent' : 'text-danger',
                    )}
                  >
                    {w.admin_note}
                  </p>
                )}

                <div className="mt-2 text-xs text-muted">
                  Số dư hiện tại:{' '}
                  <b className="money text-fg">{formatVnd(wallets[w.user_id]?.balance_vnd ?? 0)}</b>
                </div>

                {open && isSelf && (
                  <div className="mt-3 rounded-lg border border-danger/35 bg-danger/10 p-3 text-[13px] text-danger">
                    Đây là yêu cầu của chính bạn — không thể tự duyệt.
                  </div>
                )}

                {open && !isSelf && (
                  <div className="sticky bottom-16 mt-3 flex flex-wrap gap-2 bg-bg/85 py-2 backdrop-blur-sm md:static md:bg-transparent md:backdrop-blur-none">
                    {w.status === 'pending' && (
                      <Button
                        size="lg"
                        variant="subtle"
                        className="flex-1"
                        disabled={busy !== null && busy !== w.id}
                        onClick={() => act(w, 'processing')}
                      >
                        Đang xử lý
                      </Button>
                    )}

                    {/* Thẻ cào: bắt buộc nhập mã thẻ mới được hoàn thành */}
                    {w.method === 'card' ? (
                      <Button
                        size="lg"
                        className="flex-1"
                        disabled={busy !== null && busy !== w.id}
                        onClick={() => {
                          setDelivering(w)
                          setCardCode('')
                          setCardSerial('')
                          setCodeErr('')
                        }}
                      >
                        🎟 Giao mã thẻ
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="flex-1"
                        loading={busy === w.id}
                        disabled={busy !== null && busy !== w.id}
                        onClick={() =>
                          act(
                            w,
                            'approved',
                            w.method === 'game'
                              ? 'Đã nạp vào tài khoản game'
                              : 'Đã chuyển khoản',
                          )
                        }
                      >
                        ✓ Hoàn thành
                      </Button>
                    )}

                    <Button
                      size="lg"
                      variant="danger"
                      className="flex-1"
                      disabled={busy !== null && busy !== w.id}
                      onClick={() => {
                        setRejecting(w)
                        setReason('')
                        setReasonErr('')
                      }}
                    >
                      ✕ Từ chối
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Giao thẻ cào */}
      <Modal
        open={!!delivering}
        onClose={() => setDelivering(null)}
        title="Giao mã thẻ cào"
        footer={
          <>
            <Button variant="outline" onClick={() => setDelivering(null)}>
              Huỷ
            </Button>
            <Button loading={busy === delivering?.id} onClick={doDeliver}>
              Giao thẻ & hoàn thành
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Yêu cầu{' '}
          <b className="money text-money">{formatVnd(delivering?.amount_vnd ?? 0)}</b> thẻ{' '}
          <b>{delivering?.card_brand}</b> cho {delivering?.user_name || delivering?.user_email}.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Mã thẻ" required error={codeErr} hint="Người nhận sẽ thấy mã này.">
            <Textarea
              rows={2}
              value={cardCode}
              onChange={(e) => {
                setCardCode(e.target.value)
                setCodeErr('')
              }}
              invalid={!!codeErr}
              placeholder="Dán mã thẻ cào vào đây"
              className="money"
            />
          </Field>
          <Field label="Serial (không bắt buộc)">
            <Input
              value={cardSerial}
              onChange={(e) => setCardSerial(e.target.value)}
              className="money"
            />
          </Field>
        </div>
      </Modal>

      {/* Từ chối */}
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Từ chối yêu cầu rút tiền"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Huỷ
            </Button>
            <Button variant="danger" loading={busy === rejecting?.id} onClick={doReject}>
              Từ chối & hoàn tiền
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Số tiền <b className="money text-money">{formatVnd(rejecting?.amount_vnd ?? 0)}</b>{' '}
          sẽ được hoàn lại ví người nhận ngay.
        </p>
        <div className="mt-4">
          <Field label="Lý do từ chối" required error={reasonErr}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setReasonErr('')
              }}
              invalid={!!reasonErr}
              placeholder="Ví dụ: không xác minh được tài khoản…"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Line({ k, v, mono, strong }: { k: string; v: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd
        className={cx('truncate text-right', mono && 'money text-[13px]', strong && 'font-bold text-accent')}
        title={v}
      >
        {v}
      </dd>
    </div>
  )
}
