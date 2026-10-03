import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Empty, Field, Modal, Spinner, Textarea } from '../../components/ui'
import { supabase, errMessage } from '../../lib/supabase'
import { formatVnd } from '../../lib/money'
import {
  PLATFORM_LABEL,
  PLATFORM_STYLE,
  type Profile,
  type Submission,
} from '../../lib/types'

export default function ReviewQueue() {
  const toast = useToast()
  const [subs, setSubs] = useState<Submission[]>([])
  const [people, setPeople] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Submission | null>(null)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_submissions')
      .select('*')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true })
      .limit(200)
    if (error) return toast(errMessage(error, 'Không tải được hàng đợi.'), 'err')

    const rows = (data as Submission[]) ?? []
    setSubs(rows)

    // Admin đọc được toàn bộ profile, nên lấy tên người gửi để duyệt cho dễ
    const ids = [...new Set(rows.map((r) => r.worker_id))]
    if (ids.length) {
      const { data: p } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, created_at')
        .in('id', ids)
      setPeople(Object.fromEntries(((p as Profile[]) ?? []).map((x) => [x.id, x])))
    } else {
      setPeople({})
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (s: Submission) => {
    setBusy(s.id)
    const { error } = await supabase.rpc('admin_review_submission', {
      p_submission_id: s.id,
      p_approve: true,
      p_note: '',
    })
    setBusy(null)
    if (error) return toast(errMessage(error), 'err')
    toast(`Đã duyệt và cộng ${formatVnd(s.price_vnd)} vào ví.`, 'ok')
    void load()
  }

  const doReject = async () => {
    if (!rejecting) return
    if (reason.trim().length < 3) return setReasonErr('Vui lòng nêu lý do (tối thiểu 3 ký tự).')
    setBusy(rejecting.id)
    const { error } = await supabase.rpc('admin_review_submission', {
      p_submission_id: rejecting.id,
      p_approve: false,
      p_note: reason.trim(),
    })
    setBusy(null)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã từ chối. Người nhận sẽ thấy lý do và sửa lại được.', 'ok')
    setRejecting(null)
    setReason('')
    setReasonErr('')
    void load()
  }

  if (loading) return <Spinner label="Đang tải hàng đợi…" />

  const total = subs.reduce((s, x) => s + x.price_vnd, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Duyệt thành quả</h1>
          <p className="mt-1 text-sm text-muted">
            Mở link kiểm tra trước khi duyệt. Duyệt xong tiền cộng ngay vào ví.
          </p>
        </div>
        {subs.length > 0 && (
          <div className="text-right">
            <div className="money text-money text-lg font-bold">{formatVnd(total)}</div>
            <div className="text-xs text-muted">{subs.length} lượt đang chờ</div>
          </div>
        )}
      </div>

      {subs.length === 0 ? (
        <Empty title="Không có lượt nào chờ duyệt" hint="Mọi thành quả đã được xử lý xong." />
      ) : (
        <div className="space-y-3">
          {subs.map((s) => {
            const who = people[s.worker_id]
            return (
              <Card key={s.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge className={PLATFORM_STYLE[s.platform]}>
                        {PLATFORM_LABEL[s.platform]}
                      </Badge>
                      <span className="truncate text-xs text-muted">
                        {who?.full_name || who?.email || 'Không rõ người gửi'}
                      </span>
                    </div>
                    <h3 className="text-[15px] leading-snug font-bold">{s.title}</h3>
                  </div>
                  <div className="money text-money shrink-0 text-lg font-bold">
                    {formatVnd(s.price_vnd)}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-[10px] font-bold tracking-wider text-muted uppercase">
                    Link thành quả
                  </div>
                  <a
                    href={s.result_url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate rounded-lg border border-accent/25 bg-accent/8 px-3 py-2.5 font-mono text-xs text-accent hover:underline"
                  >
                    {s.result_url}
                  </a>
                </div>

                {s.note && (
                  <p className="mt-2.5 rounded-lg bg-line/5 px-3 py-2 text-[13px] text-muted">
                    “{s.note}”
                  </p>
                )}

                {/* Trên điện thoại nút dính đáy, bấm bằng ngón tay cho dễ */}
                <div className="sticky bottom-16 mt-4 flex gap-2 bg-bg/85 py-2 backdrop-blur-sm md:static md:bg-transparent md:backdrop-blur-none">
                  <Button
                    className="flex-1"
                    size="lg"
                    loading={busy === s.id}
                    disabled={busy !== null && busy !== s.id}
                    onClick={() => approve(s)}
                  >
                    ✓ Duyệt
                  </Button>
                  <Button
                    className="flex-1"
                    size="lg"
                    variant="danger"
                    disabled={busy !== null && busy !== s.id}
                    onClick={() => {
                      setRejecting(s)
                      setReason('')
                      setReasonErr('')
                    }}
                  >
                    ✕ Từ chối
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Từ chối thành quả"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Huỷ
            </Button>
            <Button variant="danger" loading={busy === rejecting?.id} onClick={doReject}>
              Xác nhận từ chối
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Người nhận sẽ thấy lý do này và được sửa lại rồi gửi duyệt lần nữa.
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
              placeholder="Ví dụ: link không truy cập được, kết quả chưa hiển thị…"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
