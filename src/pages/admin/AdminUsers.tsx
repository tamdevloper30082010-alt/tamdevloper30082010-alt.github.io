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
import { formatVnd, parseSignedVnd } from '../../lib/money'
import type { Profile, Wallet } from '../../lib/types'

type Mode = 'adjust' | 'payout' | null

export default function AdminUsers() {
  const { profile: me } = useAuth()
  const toast = useToast()

  const [users, setUsers] = useState<Profile[]>([])
  const [wallets, setWallets] = useState<Record<string, Wallet>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [target, setTarget] = useState<Profile | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [amount, setAmount] = useState('')
  const [sign, setSign] = useState<'1' | '-1'>('1')
  const [note, setNote] = useState('')
  const [formErr, setFormErr] = useState('')

  const load = useCallback(async () => {
    const [u, w] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('v_wallet').select('*').limit(300),
    ])
    if (u.error) return toast(errMessage(u.error, 'Không tải được danh sách người dùng.'), 'err')
    setUsers((u.data as Profile[]) ?? [])
    setWallets(Object.fromEntries(((w.data as Wallet[]) ?? []).map((x) => [x.user_id, x])))
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const setRole = async (p: Profile, role: 'admin' | 'worker') => {
    if (p.id === me?.id) return toast('Bạn không thể tự đổi quyền của mình.', 'err')
    setBusy(p.id)
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: p.id, p_role: role })
    setBusy(null)
    if (error) return toast(errMessage(error), 'err')
    toast(`Đã đổi quyền ${p.email} thành ${role === 'admin' ? 'quản trị viên' : 'người nhận'}.`, 'ok')
    void load()
  }

  /** Ô nhập chỉ chứa số; dấu do nút bấm quyết định (bàn phím điện thoại không có phím −). */
  const amountValue = useMemo(() => {
    const n = parseSignedVnd(amount)
    return n === null ? 0 : n
  }, [amount])

  const projected =
    target && mode === 'adjust'
      ? (wallets[target.id]?.balance_vnd ?? 0) + amountValue
      : null

  const submitMoney = async () => {
    if (!target || !mode) return
    const n = mode === 'adjust' ? amountValue * Number(sign) : amountValue
    if (!Number.isSafeInteger(n) || n === 0) return setFormErr('Nhập số tiền hợp lệ.')
    if (mode === 'payout' && n <= 0) return setFormErr('Số tiền rút phải lớn hơn 0.')
    if (mode === 'adjust' && note.trim().length < 3)
      return setFormErr('Phải nêu lý do điều chỉnh (tối thiểu 3 ký tự).')

    // Sổ cái là append-only: ghi sai thì không sửa được, chỉ tạo dòng điều
    // chỉnh ngược lại. Nên hỏi lại trước khi đẩy tài khoản xuống dưới 0.
    if (mode === 'adjust' && projected !== null && projected < 0) {
      const ok = confirm(
        `Số dư của ${target.full_name || target.email} sẽ thành ` +
          `${formatVnd(projected)} (đang âm).\n\n` +
          `Từ giờ tới khi kiếm nhiệm vụ bù về 0, tài khoản này KHÔNG rút được tiền.\n\n` +
          `Xác nhận?`,
      )
      if (!ok) return
    }

    setBusy(target.id)
    const { error } =
      mode === 'payout'
        ? await supabase.rpc('admin_payout', {
            p_user_id: target.id,
            p_amount_vnd: n,
            p_note: note.trim() || 'Rút tiền',
          })
        : await supabase.rpc('admin_adjust_balance', {
            p_user_id: target.id,
            p_amount_vnd: n,
            p_note: note.trim(),
          })
    setBusy(null)
    if (error) return setFormErr(errMessage(error))
    toast(mode === 'payout' ? 'Đã ghi nhận rút tiền.' : 'Đã điều chỉnh số dư.', 'ok')
    setMode(null)
    setTarget(null)
    setAmount('')
    setSign('1')
    setNote('')
    setFormErr('')
    void load()
  }

  const openMoney = (p: Profile, m: Mode) => {
    setTarget(p)
    setMode(m)
    setAmount('')
    setSign('1')
    setNote('')
    setFormErr('')
  }

  if (loading) return <Spinner label="Đang tải…" />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Người dùng</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} tài khoản · mọi thay đổi quyền đều được ghi vào nhật ký.
        </p>
      </div>

      {users.length === 0 ? (
        <Empty title="Chưa có người dùng nào" />
      ) : (
        <div className="space-y-3">
          {users.map((p) => {
            const w = wallets[p.id]
            const isMe = p.id === me?.id
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{p.full_name || 'Chưa đặt tên'}</span>
                      {p.role === 'admin' ? (
                        <Badge className="bg-money/15 text-money">QUẢN TRỊ</Badge>
                      ) : (
                        <Badge className="bg-info/15 text-info">NGƯỜI NHẬN</Badge>
                      )}
                      {isMe && <Badge className="bg-line/10 text-muted">BẠN</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{p.email}</div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`money text-lg font-bold ${
                        (w?.balance_vnd ?? 0) < 0 ? 'text-danger' : 'text-money'
                      }`}
                    >
                      {formatVnd(w?.balance_vnd ?? 0)}
                    </div>
                    <div className="text-[10px] text-muted">
                      tổng kiếm {formatVnd(w?.total_earned_vnd ?? 0)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isMe || busy === p.id}
                    onClick={() => setRole(p, p.role === 'admin' ? 'worker' : 'admin')}
                  >
                    {p.role === 'admin' ? 'Bỏ quyền admin' : 'Cấp quyền admin'}
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => openMoney(p, 'adjust')}>
                    Điều chỉnh số dư
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={(w?.balance_vnd ?? 0) <= 0}
                    onClick={() => openMoney(p, 'payout')}
                  >
                    Ghi nhận rút tiền
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={!!target && !!mode}
        onClose={() => {
          setMode(null)
          setTarget(null)
        }}
        title={mode === 'payout' ? 'Ghi nhận rút tiền' : 'Điều chỉnh số dư'}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setMode(null)
                setTarget(null)
              }}
            >
              Huỷ
            </Button>
            <Button loading={busy === target?.id} onClick={submitMoney}>
              Xác nhận
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {target?.email} — số dư hiện tại{' '}
          <b
            className={cx(
              'money',
              (wallets[target?.id ?? '']?.balance_vnd ?? 0) < 0 ? 'text-danger' : 'text-money',
            )}
          >
            {formatVnd(wallets[target?.id ?? '']?.balance_vnd ?? 0)}
          </b>
        </p>

        <div className="mt-4 space-y-4">
          <Field
            label={mode === 'payout' ? 'Số tiền đã chuyển khoản (VND)' : 'Số tiền điều chỉnh (VND)'}
            required
            hint={
              mode === 'adjust'
                ? 'Bấm − để trừ nợ, + để cộng. Ô nhập chỉ nhận số.'
                : undefined
            }
          >
            {mode === 'adjust' && (
              <div className="mb-2 flex gap-1.5">
                {(['1', '-1'] as const).map((sg) => (
                  <button
                    key={sg}
                    type="button"
                    onClick={() => {
                      setSign(sg)
                      setFormErr('')
                    }}
                    className={`h-9 cursor-pointer rounded-lg px-5 text-sm font-bold transition-all ${
                      sign === sg
                        ? 'bg-accent text-black'
                        : 'bg-line/8 text-muted hover:text-fg'
                    }`}
                  >
                    {sg === '1' ? '+ Cộng' : '− Trừ'}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={amount}
              onChange={(e) => {
                // Ô chỉ nhận số; dấu do nút bấm quyết định. Bàn phím điện
                // thoại không có phím "−" nên không thể trông chờ người dùng gõ.
                const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 12)
                setAmount(digits)
                setFormErr('')
              }}
              placeholder={mode === 'payout' ? '100000' : '50000'}
              inputMode="numeric"
              className="money font-bold"
            />
          </Field>

          {mode === 'adjust' && projected !== null && amountValue !== 0 && (
            <div
              className={`rounded-xl border px-3.5 py-2.5 text-[13px] ${
                projected < 0
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : 'border-line/12 bg-line/5 text-muted'
              }`}
            >
              Số dư sau khi điều chỉnh:{' '}
              <b className="money text-fg">
                {formatVnd(projected)}
              </b>
              {projected < 0 && (
                <span className="mt-1 block font-semibold">
                  Tài khoản này sẽ không rút được tiền cho tới khi làm nhiệm vụ bù về 0.
                </span>
              )}
            </div>
          )}

          <Field
            label="Ghi chú"
            required={mode === 'adjust'}
            error={formErr}
            hint="Lưu vào sổ cái, không sửa được sau này."
          >
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setFormErr('')
              }}
              invalid={!!formErr}
              placeholder={mode === 'payout' ? 'Đã chuyển khoản ngân hàng' : 'Lý do điều chỉnh…'}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
