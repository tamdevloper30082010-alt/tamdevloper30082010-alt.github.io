import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  cx,
} from '../components/ui'
import { supabase, errMessage } from '../lib/supabase'
import { formatVnd, parseVnd, stripSeparators } from '../lib/money'
import {
  CARD_BRANDS,
  CARD_DENOMS,
  GAME_PLATFORMS,
  METHOD_LABEL,
  MIN_BANK_WITHDRAW,
  WITHDRAW_STATUS_LABEL,
  WITHDRAW_STATUS_STYLE,
  type Wallet,
  type WithdrawMethod,
  type Withdrawal,
} from '../lib/types'

type Form = {
  amount: string
  bank: string
  holder: string
  number: string
  gamePlatform: string
  gameId: string
  cardBrand: string
  note: string
}

const empty: Form = {
  amount: '',
  bank: '',
  holder: '',
  number: '',
  gamePlatform: GAME_PLATFORMS[0],
  gameId: '',
  cardBrand: CARD_BRANDS[0],
  note: '',
}

const TABS: { k: WithdrawMethod; label: string; hint: string }[] = [
  { k: 'game', label: '🎮 Nạp vào game', hint: 'Free Fire, Roblox, Liên Quân' },
  { k: 'card', label: '🎟 Thẻ cào', hint: 'Viettel, Vinaphone, Zing…' },
  { k: 'bank', label: '🏦 Ngân hàng', hint: 'Chuyển khoản trực tiếp' },
]

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={cx('truncate text-right font-medium', mono && 'money text-[13px]')} title={v}>
        {v}
      </dd>
    </div>
  )
}

function RequestCard({ w, onChange }: { w: Withdrawal; onChange: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const cancel = async () => {
    if (!confirm('Huỷ yêu cầu rút này? Số tiền sẽ được hoàn lại ví.')) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_withdrawal', { p_id: w.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã huỷ yêu cầu, tiền đã về lại ví.', 'ok')
    onChange()
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(w.card_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('Trình duyệt chặn sao chép. Hãy bôi đen rồi copy.', 'err')
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="bg-line/10 text-muted">{METHOD_LABEL[w.method]}</Badge>
            <Badge className={WITHDRAW_STATUS_STYLE[w.status]}>
              {WITHDRAW_STATUS_LABEL[w.status]}
            </Badge>
          </div>
          <div className="money text-money mt-1.5 text-xl font-bold">
            {formatVnd(w.amount_vnd)}
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          {new Date(w.created_at).toLocaleString('vi-VN')}
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-[13px]">
        {w.method === 'bank' && (
          <>
            <Row k="Ngân hàng" v={w.bank_code} />
            <Row k="Chủ tài khoản" v={w.bank_holder} />
            <Row k="Số tài khoản" v={w.bank_number} mono />
          </>
        )}
        {w.method === 'game' && (
          <>
            <Row k="Game" v={w.game_platform} />
            <Row k="ID tài khoản" v={w.game_account_id} mono />
          </>
        )}
        {w.method === 'card' && <Row k="Thương hiệu" v={w.card_brand} />}
      </dl>

      {/* Mã thẻ cào do ADMIN gửi, chỉ hiện khi đã giao */}
      {w.method === 'card' && w.status === 'approved' && w.card_code && (
        <div className="mt-3 rounded-xl border border-accent/35 bg-accent/8 p-3">
          <div className="text-[10px] font-bold tracking-wider text-accent uppercase">
            Mã thẻ cào của bạn
          </div>
          <div className="money mt-1.5 text-base leading-relaxed font-bold break-all text-fg">
            {w.card_code}
          </div>
          {w.card_serial && (
            <div className="mt-1 text-xs text-muted">Serial: {w.card_serial}</div>
          )}
          <Button size="sm" variant="outline" className="mt-2.5" onClick={copyCode}>
            {copied ? '✓ Đã sao chép' : 'Sao chép mã'}
          </Button>
        </div>
      )}

      {w.method !== 'card' && w.status === 'approved' && (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/8 p-3 text-[13px] text-accent">
          ✓ Đã hoàn thành
          {w.method === 'game' && ' — vật phẩm đã được nạp vào tài khoản game của bạn.'}
        </div>
      )}

      {w.method === 'card' && (w.status === 'pending' || w.status === 'processing') && (
        <p className="mt-3 text-xs text-muted">
          Admin đang chuẩn bị thẻ. Mã sẽ hiện ở đây ngay khi được giao.
        </p>
      )}

      {w.note && <p className="mt-2.5 text-xs text-muted">Ghi chú: {w.note}</p>}

      {w.admin_note && w.status !== 'cancelled' && (
        <div
          className={cx(
            'mt-3 rounded-lg border p-3 text-[13px]',
            w.status === 'approved' ? 'border-accent/30 bg-accent/8 text-accent' : 'border-danger/35 bg-danger/10 text-danger',
          )}
        >
          {w.status === 'approved' ? '✓ ' : '⚠ '}
          {w.admin_note}
        </div>
      )}

      {w.status === 'pending' && (
        <button
          onClick={cancel}
          disabled={busy}
          className="mt-3 cursor-pointer text-xs font-semibold text-muted underline-offset-2 transition-colors hover:text-danger hover:underline disabled:opacity-50"
        >
          {busy ? 'Đang huỷ…' : 'Huỷ yêu cầu (hoàn tiền)'}
        </button>
      )}
    </Card>
  )
}

export default function Withdraw() {
  const { session } = useAuth()
  const toast = useToast()

  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [list, setList] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<WithdrawMethod>('game')
  const [form, setForm] = useState<Form>(empty)
  const [errs, setErrs] = useState<Partial<Record<keyof Form, string>>>({})
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    const [w, l] = await Promise.all([
      supabase.from('v_wallet').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('v_withdrawals').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    if (l.error) toast(errMessage(l.error, 'Không tải được danh sách yêu cầu.'), 'err')
    setWallet((w.data as Wallet) ?? null)
    setList((l.data as Withdrawal[]) ?? [])
    setLoading(false)
  }, [session, toast])

  useEffect(() => {
    void load()
  }, [load])

  const balance = wallet?.balance_vnd ?? 0
  const amount = parseVnd(form.amount) ?? 0

  const validate = (): boolean => {
    const e: Partial<Record<keyof Form, string>> = {}
    const a = parseVnd(form.amount)

    if (!a) e.amount = 'Chọn mệnh giá trước đã.'
    else if (a > balance) e.amount = `Số dư chỉ có ${formatVnd(balance)}.`

    if (tab === 'game' || tab === 'card') {
      if (!(CARD_DENOMS as readonly number[]).includes(a ?? -1))
        e.amount = 'Chỉ có các mệnh giá 5k, 10k, 20k, 50k, 100k, 200k.'
    } else if (a !== null && a < MIN_BANK_WITHDRAW) {
      e.amount = `Rút ngân hàng tối thiểu ${formatVnd(MIN_BANK_WITHDRAW)}.`
    }

    if (tab === 'game' && form.gameId.trim().length < 4)
      e.gameId = 'Nhập ID tài khoản trong game.'

    if (tab === 'bank') {
      if (form.bank.trim().length < 2) e.bank = 'Nhập tên ngân hàng.'
      if (form.holder.trim().length < 2) e.holder = 'Nhập tên chủ tài khoản.'
      if (!/^\d{6,20}$/.test(form.number.trim()))
        e.number = 'Số tài khoản phải là 6–20 chữ số.'
    }
    setErrs(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    setBusy(true)
    const a = parseVnd(form.amount)!
    const { error } = await supabase.rpc('create_withdrawal_request', {
      p_method: tab,
      p_amount_vnd: a,
      p_bank_code: tab === 'bank' ? form.bank.trim() : '',
      p_bank_holder: tab === 'bank' ? form.holder.trim() : '',
      p_bank_number: tab === 'bank' ? form.number.trim() : '',
      p_game_platform: tab === 'game' ? form.gamePlatform : '',
      p_game_account_id: tab === 'game' ? form.gameId.trim() : '',
      p_card_brand: tab === 'card' ? form.cardBrand : '',
      p_note: form.note.trim(),
    })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã gửi yêu cầu. Số tiền đã được trừ khỏi ví.', 'ok')
    setConfirming(false)
    setForm({ ...empty, gamePlatform: form.gamePlatform, cardBrand: form.cardBrand })
    setErrs({})
    void load()
  }

  const after = useMemo(() => balance - amount, [balance, amount])

  if (!session) return <Empty title="Bạn chưa đăng nhập" hint="Đăng nhập để rút tiền." />
  if (loading) return <Spinner label="Đang tải…" />

  const pendingCount = list.filter((w) => w.status === 'pending' || w.status === 'processing').length

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tài chính"
        icon="⇩"
        title="Rút tiền"
        desc="Số tiền bị trừ ngay khi bạn gửi yêu cầu và được hoàn trả đầy đủ nếu bị từ chối."
      />

      <Card
        className={cx(
          'bg-gradient-to-br p-5',
          balance < 0
            ? 'border-danger/35 from-danger/12 to-danger/6'
            : 'from-money/12 to-accent/8 border-money/25',
        )}
      >
        <div className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Số dư khả dụng
        </div>
        <div
          className={cx(
            'money mt-1 text-3xl font-bold',
            balance < 0 ? 'text-danger' : balance > 0 ? 'text-money' : 'text-muted',
          )}
        >
          {formatVnd(balance)}
        </div>
        {(wallet?.pending_withdraw_vnd ?? 0) > 0 && (
          <div className="mt-1 text-xs text-muted">
            {formatVnd(wallet!.pending_withdraw_vnd)} đang chờ xử lý
          </div>
        )}

        {balance < 0 ? (
          <div className="mt-3 rounded-xl border border-danger/35 bg-danger/10 p-3.5">
            <div className="text-[11px] font-bold tracking-wider text-danger uppercase">
              ⛔ Chưa được rút — số dư đang âm
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed font-medium">
              Bạn đang nợ <b className="money">{formatVnd(Math.abs(balance))}</b>. Hãy nhận và
              hoàn thành nhiệm vụ để kiếm bù về 0 — chỉ khi số dư dương bạn mới rút được.
            </p>
            <Link
              to="/"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-danger px-3.5 py-2 text-sm font-bold text-white transition-all hover:brightness-110"
            >
              Đi làm nhiệm vụ bù nợ →
            </Link>
          </div>
        ) : balance === 0 ? (
          <p className="mt-2 text-xs text-muted">
            Số dư bằng 0 — chưa rút được gì. Hãy nhận nhiệm vụ để kiếm thu nhập.
          </p>
        ) : balance < MIN_BANK_WITHDRAW ? (
          <p className="mt-2 text-xs text-muted">
            Cần tối thiểu {formatVnd(MIN_BANK_WITHDRAW)} để rút. Hãy nhận thêm nhiệm vụ.
          </p>
        ) : null}
      </Card>

      {/* Ba tab: nạp game · thẻ cào · ngân hàng */}
      <div className="grid gap-2 sm:grid-cols-3">
        {TABS.map((o) => (
          <button
            key={o.k}
            onClick={() => {
              setTab(o.k)
              setErrs({})
            }}
            className={cx(
              'cursor-pointer rounded-xl border px-3 py-3 text-left transition-all',
              tab === o.k
                ? 'border-accent/50 bg-accent/10'
                : 'border-line/12 hover:border-line/25 hover:bg-line/5',
            )}
          >
            <div className={cx('text-sm font-bold', tab === o.k ? 'text-accent' : 'text-fg')}>
              {o.label}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{o.hint}</div>
          </button>
        ))}
      </div>

      <Card className="space-y-4 p-5">
        {tab !== 'bank' && (
          <div>
            <div className="mb-1.5 text-[13px] font-semibold">
              Mệnh giá <span className="text-danger">*</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CARD_DENOMS.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setForm({ ...form, amount: String(d) })
                    setErrs((e) => ({ ...e, amount: '' }))
                  }}
                  disabled={d > balance}
                  className={cx(
                    'money cursor-pointer rounded-lg border py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-30',
                    parseVnd(form.amount) === d
                      ? 'border-accent bg-accent text-black'
                      : 'border-line/12 text-fg hover:border-accent/40',
                  )}
                >
                  {formatVnd(d)}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'game' && (
          <>
            <Field label="Nạp vào game nào">
              <Select
                value={form.gamePlatform}
                onChange={(e) => setForm({ ...form, gamePlatform: e.target.value })}
              >
                {GAME_PLATFORMS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ID tài khoản game" required error={errs.gameId}>
              <Input
                value={form.gameId}
                onChange={(e) => {
                  setForm({ ...form, gameId: stripSeparators(e.target.value).slice(0, 40) })
                  setErrs((x) => ({ ...x, gameId: '' }))
                }}
                invalid={!!errs.gameId}
                placeholder="Nhập ID trong game"
                inputMode="numeric"
                className="money font-bold"
              />
            </Field>
            <p className="rounded-lg border border-info/30 bg-info/8 p-3 text-[13px] text-info">
              Admin sẽ nạp thẳng {formatVnd(amount || 0)} vật phẩm vào tài khoản này. Bạn
              không cần mua thẻ.
            </p>
          </>
        )}

        {tab === 'card' && (
          <>
            <Field label="Thương hiệu thẻ cào">
              <Select
                value={form.cardBrand}
                onChange={(e) => setForm({ ...form, cardBrand: e.target.value })}
              >
                {CARD_BRANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="rounded-lg border border-info/30 bg-info/8 p-3 text-[13px] text-info">
              Bạn không cần mua hay nhập mã thẻ. Admin sẽ gửi mã thẻ cào vào đây sau khi
              duyệt yêu cầu.
            </p>
          </>
        )}

        {tab === 'bank' && (
          <>
            <Field label="Ngân hàng" required error={errs.bank}>
              <Input
                value={form.bank}
                onChange={(e) => {
                  setForm({ ...form, bank: e.target.value })
                  setErrs((x) => ({ ...x, bank: '' }))
                }}
                invalid={!!errs.bank}
                placeholder="Vietcombank — chi nhánh Bến Thành"
              />
            </Field>
            <Field label="Chủ tài khoản" required error={errs.holder}>
              <Input
                value={form.holder}
                onChange={(e) => {
                  setForm({ ...form, holder: e.target.value })
                  setErrs((x) => ({ ...x, holder: '' }))
                }}
                invalid={!!errs.holder}
                placeholder="NGUYEN VAN A"
              />
            </Field>
            <Field label="Số tài khoản" required error={errs.number}>
              <Input
                value={form.number}
                onChange={(e) => {
                  setForm({ ...form, number: stripSeparators(e.target.value).slice(0, 20) })
                  setErrs((x) => ({ ...x, number: '' }))
                }}
                invalid={!!errs.number}
                placeholder="0123456789"
                inputMode="numeric"
                className="money"
              />
            </Field>
          </>
        )}

        {tab === 'bank' && (
          <Field label="Số tiền rút (VND)" required error={errs.amount}>
            <Input
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: stripSeparators(e.target.value).slice(0, 12) })
                setErrs((x) => ({ ...x, amount: '' }))
              }}
              invalid={!!errs.amount}
              placeholder="50000"
              inputMode="numeric"
              className="money font-bold"
            />
          </Field>
        )}
        {errs.amount && tab !== 'bank' && (
          <p className="text-[13px] font-medium text-danger">{errs.amount}</p>
        )}

        <Field label="Ghi chú cho admin (không bắt buộc)">
          <Textarea
            rows={2}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Ví dụ: cần xử lý gấp…"
          />
        </Field>

        <Button
          block
          size="lg"
          disabled={balance <= 0}
          onClick={() => validate() && setConfirming(true)}
        >
          Xem lại & xác nhận rút
        </Button>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-bold">
          Yêu cầu của tôi {pendingCount > 0 && `(${pendingCount} đang chờ)`}
        </h2>
        {list.length === 0 ? (
          <Empty title="Chưa có yêu cầu rút nào" hint="Nạp vào game thường được xử lý nhanh nhất." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((w) => (
              <RequestCard key={w.id} w={w} onChange={() => void load()} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Xác nhận rút tiền"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Huỷ
            </Button>
            <Button loading={busy} onClick={submit}>
              Xác nhận rút {formatVnd(amount)}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <Line k="Hình thức" v={METHOD_LABEL[tab]} />
          {tab === 'game' && (
            <>
              <Line k="Game" v={form.gamePlatform} />
              <Line k="ID tài khoản" v={form.gameId} mono />
            </>
          )}
          {tab === 'card' && <Line k="Thẻ cào" v={form.cardBrand} />}
          {tab === 'bank' && (
            <>
              <Line k="Ngân hàng" v={form.bank} />
              <Line k="Số tài khoản" v={form.number} mono />
              <Line k="Chủ tài khoản" v={form.holder} />
            </>
          )}
          <div className="flex justify-between border-t border-line/10 pt-3 text-base">
            <span className="font-semibold">Số tiền rút</span>
            <span className="money text-money font-bold">{formatVnd(amount)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Số dư sau khi rút</span>
            <span className="money">{formatVnd(after)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-info/30 bg-info/8 p-3 text-[13px] text-info">
          Số tiền bị trừ khỏi ví <b>ngay khi gửi</b>. Nếu bị từ chối, sẽ được hoàn lại đầy đủ.
        </div>
      </Modal>
    </div>
  )
}

function Line({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted">{k}</span>
      <span className={cx('truncate text-right font-semibold', mono && 'money')}>{v}</span>
    </div>
  )
}
