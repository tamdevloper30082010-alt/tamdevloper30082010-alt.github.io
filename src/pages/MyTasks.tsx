import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/auth'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Spinner,
  Textarea,
  cx,
} from '../components/ui'
import { supabase, errMessage } from '../lib/supabase'
import { formatVnd } from '../lib/money'
import {
  evidenceAccept,
  evidenceExt,
  evidenceSizeLabel,
  evidenceUrl,
  removeEvidence,
  uploadEvidence,
  MAX_EVIDENCE_BYTES,
} from '../lib/proof'
import {
  TASK_TYPE_LABEL,
  TASK_TYPE_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  type Submission,
  type SubmissionStatus,
} from '../lib/types'

const TABS: { key: SubmissionStatus; label: string }[] = [
  { key: 'in_progress', label: 'Đang làm' },
  { key: 'submitted', label: 'Chờ duyệt' },
  { key: 'rejected', label: 'Bị từ chối' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'cancelled', label: 'Đã bỏ' },
]

/** Ảnh chứng minh đã gửi đi — xem lại được qua link có chữ ký ngắn hạn. */
function EvidenceView({ path, tone }: { path: string; tone: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void evidenceUrl(path).then((u) => {
      if (!alive) return
      setUrl(u)
      if (!u) setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [path])

  if (failed) {
    return (
      <p className={cx('rounded-lg border border-line/15 bg-line/5 px-3 py-2 text-xs', tone)}>
        Ảnh không tải được — có thể đã bị xoá để tiết kiệm dung lượng.
      </p>
    )
  }
  if (!url) return <div className="h-32 animate-pulse rounded-xl bg-line/8" />

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-line/15"
    >
      <img
        src={url}
        alt="Ảnh thành quả"
        loading="lazy"
        className="max-h-64 w-full cursor-zoom-in bg-black/25 object-contain"
      />
    </a>
  )
}

/** Ô nhập link thành quả — chỉ hiện khi lượt còn có thể gửi. */
function SubmitBox({
  sub,
  targetUrl,
  onDone,
}: {
  sub: Submission
  targetUrl: string | null
  onDone: () => void
}) {
  const { profile } = useAuth()
  const toast = useToast()
  const isLink = sub.task_type === 'link'

  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Giải phóng object URL — nếu quên thì mỗi lần đổi ảnh rò một chút RAM.
  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`Đã sao chép ${what}.`, 'ok')
    } catch {
      toast('Trình duyệt chặn sao chép. Hãy bôi đen rồi copy.', 'err')
    }
  }

  const pick = (f: File | null) => {
    if (!f) return
    if (!evidenceExt(f.type)) {
      return setErr('Chỉ nhận ảnh JPG, PNG hoặc WEBP.')
    }
    if (f.size > MAX_EVIDENCE_BYTES) {
      return setErr(`Ảnh nặng ${(f.size / 1024 / 1024).toFixed(1)} MB — vượt quá ${evidenceSizeLabel()}.`)
    }
    setErr('')
    setFile(f)
  }

  const send = async () => {
    setErr('')

    let v = ''
    let path: string | null = null

    if (isLink) {
      v = url.trim()
      if (!/^https?:\/\/\S+$/i.test(v)) {
        return setErr('Link phải bắt đầu bằng http:// hoặc https://')
      }
    } else {
      if (!file) return setErr('Hãy chọn ảnh chứng minh bạn đã hoàn thành nhiệm vụ.')
      if (!profile) return setErr('Chưa đăng nhập.')
      setBusy(true)
      try {
        path = await uploadEvidence(profile.id, sub.id, file)
      } catch (e) {
        setBusy(false)
        return setErr(e instanceof Error ? e.message : 'Không tải được ảnh lên.')
      }
    }

    setBusy(true)
    const { error } = await supabase.rpc('submit_result', {
      p_submission_id: sub.id,
      p_result_url: v,
      p_note: note.trim(),
      p_evidence_path: path,
    })
    setBusy(false)

    if (error) {
      // Ảnh đã lên bucket mà database từ chối thì xoá luôn, không để rác.
      if (path) void removeEvidence(path)
      setErr(errMessage(error))
      return
    }

    // Bị từ chối rồi gửi lại: ảnh cũ không còn dùng → xoá cho khỏi phí.
    if (sub.evidence_path && sub.evidence_path !== path) {
      void removeEvidence(sub.evidence_path)
    }

    toast('Đã gửi thành quả! Admin sẽ duyệt và cộng tiền.', 'ok')
    setUrl('')
    setNote('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
    onDone()
  }

  return (
    <>
      {/* ① LINK CẦN VƯỢT — chỉ nhiệm vụ loại "vượt link" mới có */}
      {isLink && (
        <div className="mt-4 rounded-xl border border-info/30 bg-info/8 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-wider text-info uppercase">
              ① Link cần vượt
            </span>
            {targetUrl && (
              <button
                onClick={() => copy(targetUrl, 'link')}
                className="cursor-pointer text-xs font-semibold text-info hover:underline"
              >
                Sao chép
              </button>
            )}
          </div>
          {targetUrl ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-black/25 px-3 py-2 font-mono text-xs text-fg sm:text-[13px]">
                {targetUrl}
              </code>
              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-info hover:brightness-110 inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-bold text-black transition-all"
              >
                Mở link ↗
              </a>
            </div>
          ) : (
            <div className="text-sm text-muted">Không lấy được link. Tải lại trang thử lại.</div>
          )}
        </div>
      )}

      {/* Ô NỘP THÀNH QUẢ */}
      <div className="mt-3 rounded-xl border border-line/12 bg-line/[0.04] p-4">
        <div className="mb-2 text-[11px] font-bold tracking-wider text-accent uppercase">
          {isLink ? '② Gửi link thành quả' : '① Nộp ảnh thành quả'}
        </div>

        {isLink ? (
          <Field label="Dán link kết quả của bạn vào đây" required>
            <Textarea
              rows={2}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              invalid={!!err}
              placeholder="https://…"
              inputMode="url"
            />
          </Field>
        ) : (
          <div>
            {sub.description && (
              <div className="mb-3 rounded-xl border border-line/12 bg-line/5 p-3">
                <div className="text-[10px] font-bold tracking-wider text-muted uppercase">
                  Việc cần làm
                </div>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
                  {sub.description}
                </p>
              </div>
            )}

            <Field
              label="Ảnh chứng minh đã hoàn thành"
              required
              hint={`JPG / PNG / WEBP, tối đa ${evidenceSizeLabel()}. Ảnh bị xoá tự động sau khi admin duyệt.`}
            >
              <input
                ref={fileRef}
                type="file"
                accept={evidenceAccept()}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer text-sm text-muted
                  file:mr-3 file:cursor-pointer file:rounded-lg file:border-0
                  file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-black
                  hover:file:brightness-110"
              />
            </Field>

            {preview && (
              <div className="mt-3 overflow-hidden rounded-xl border border-line/15">
                <img
                  src={preview}
                  alt="Xem trước"
                  className="max-h-56 w-full bg-black/25 object-contain"
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          <Field label="Ghi chú cho admin (không bắt buộc)">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isLink
                  ? 'Ví dụ: đã vượt xong, lượt hiển thị tăng…'
                  : 'Ví dụ: đã chụp màn hình đơn hàng, mã ở góc phải…'
              }
            />
          </Field>
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/12 px-3 py-2.5 text-[13px] font-medium text-danger">
            {err}
          </div>
        )}

        <Button className="mt-4" block size="lg" loading={busy} onClick={send}>
          Gửi duyệt
        </Button>
        <p className="mt-2.5 text-center text-xs text-muted">
          Tiền chỉ được cộng sau khi admin duyệt thành quả.
        </p>
      </div>
    </>
  )
}

function SubCard({
  sub,
  targetUrl,
  onDone,
}: {
  sub: Submission
  targetUrl: string | null
  onDone: () => void
}) {
  const toast = useToast()
  const [canceling, setCanceling] = useState(false)
  const editable = sub.status === 'in_progress' || sub.status === 'rejected'

  const abandon = async () => {
    setCanceling(true)
    const { error } = await supabase.rpc('cancel_my_submission', { p_submission_id: sub.id })
    setCanceling(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã bỏ lượt. Bạn có thể nhận nhiệm vụ khác.', 'ok')
    onDone()
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge className={TASK_TYPE_STYLE[sub.task_type]}>
              {TASK_TYPE_LABEL[sub.task_type]}
            </Badge>
            <Badge className={STATUS_STYLE[sub.status]}>{STATUS_LABEL[sub.status]}</Badge>
          </div>
          <h3 className="text-[15px] leading-snug font-bold">{sub.title}</h3>
          {sub.description && (
            <p className="mt-1 line-clamp-2 text-[13px] text-muted">{sub.description}</p>
          )}
        </div>
        <div className="text-right">
          <div className="money text-money text-lg font-bold">{formatVnd(sub.price_vnd)}</div>
          <div className="text-[10px] text-muted">nhận được</div>
        </div>
      </div>

      {sub.admin_note && sub.status === 'rejected' && (
        <div className="mt-4 rounded-xl border border-danger/35 bg-danger/10 p-4">
          <div className="text-[11px] font-bold tracking-wider text-danger uppercase">
            ⚠ Admin từ chối
          </div>
          <p className="mt-1.5 text-sm font-medium">{sub.admin_note}</p>
          <p className="mt-1.5 text-xs text-muted">
            Sửa lại thành quả rồi gửi duyệt lần nữa nhé.
          </p>
          {sub.evidence_path && (
            <div className="mt-3">
              <EvidenceView path={sub.evidence_path} tone="text-muted" />
            </div>
          )}
        </div>
      )}

      {editable && <SubmitBox sub={sub} targetUrl={targetUrl} onDone={onDone} />}

      {sub.status === 'submitted' && (
        <div className="mt-4 rounded-xl border border-money/30 bg-money/8 p-4">
          <div className="text-[11px] font-bold tracking-wider text-money uppercase">
            ⏳ Đang chờ admin duyệt
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Thành quả đã được gửi. Tiền sẽ cộng vào ví ngay khi duyệt.
          </p>
          {sub.result_url && (
            <a
              href={sub.result_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block truncate font-mono text-xs text-money hover:underline"
            >
              {sub.result_url}
            </a>
          )}
          {sub.evidence_path && (
            <div className="mt-3">
              <EvidenceView path={sub.evidence_path} tone="text-muted" />
            </div>
          )}
        </div>
      )}

      {sub.status === 'approved' && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/8 p-4">
          <div className="text-[11px] font-bold tracking-wider text-accent uppercase">
            ✓ Đã duyệt — đã cộng tiền
          </div>
          {sub.result_url && (
            <a
              href={sub.result_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 block truncate font-mono text-xs text-accent hover:underline"
            >
              {sub.result_url}
            </a>
          )}
          {!sub.result_url && sub.task_type === 'other' && (
            <p className="mt-1.5 text-xs text-muted">
              Ảnh thành quả đã được xoá khỏi hệ thống sau khi duyệt để tiết kiệm dung lượng.
            </p>
          )}
        </div>
      )}

      {sub.status === 'cancelled' && (
        <div className="mt-4 rounded-xl border border-line/12 bg-line/5 p-3 text-sm text-muted">
          Lượt này đã được trả về kho.
        </div>
      )}

      {editable && (
        <button
          onClick={abandon}
          disabled={canceling}
          className="mt-4 cursor-pointer text-xs font-semibold text-muted underline-offset-2 transition-colors hover:text-danger hover:underline disabled:opacity-50"
        >
          {canceling ? 'Đang bỏ…' : 'Bỏ lượt này (trả về kho)'}
        </button>
      )}
    </Card>
  )
}

export default function MyTasks() {
  const { session } = useAuth()
  const toast = useToast()
  const [subs, setSubs] = useState<Submission[]>([])
  const [targets, setTargets] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<SubmissionStatus>('in_progress')

  const load = useCallback(async () => {
    if (!session) return
    const { data, error } = await supabase
      .from('v_submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) {
      toast(errMessage(error, 'Không tải được danh sách.'), 'err')
      return
    }
    const rows = (data as Submission[]) ?? []
    setSubs(rows)

    // Link chỉ được lấy sau khi đã nhận lượt — hàm RPC tự kiểm tra chủ sở hữu.
    const need = rows.filter((s) => ['in_progress', 'rejected'].includes(s.status)).map((s) => s.id)
    if (need.length) {
      const pairs = await Promise.all(
        need.map(async (id) => {
          const { data: u } = await supabase.rpc('get_target_url', { p_submission_id: id })
          return [id, (u as string | null) ?? null] as const
        }),
      )
      setTargets(Object.fromEntries(pairs))
    } else {
      setTargets({})
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    subs.forEach((s) => (c[s.status] = (c[s.status] ?? 0) + 1))
    return c
  }, [subs])

  const list = subs.filter((s) => s.status === tab)

  if (!session) {
    return <Empty title="Bạn chưa đăng nhập" hint="Đăng nhập để xem các nhiệm vụ đã nhận." />
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Nhiệm vụ của tôi</h1>
        <p className="mt-1 text-sm text-muted">
          Nhấn vào nhiệm vụ đang làm để lấy link cần vượt và gửi link thành quả.
        </p>
      </div>

      {/* Tabs — cuộn ngang trên điện thoại */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-all',
              tab === t.key
                ? 'bg-accent text-black'
                : 'hover:bg-line/8 text-muted hover:text-fg',
            )}
          >
            {t.label}
            {counts[t.key] ? (
              <span
                className={cx(
                  'money ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  tab === t.key ? 'bg-black/20' : 'bg-line/10',
                )}
              >
                {counts[t.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Đang tải…" />
      ) : list.length === 0 ? (
        <Empty
          title={`Chưa có nhiệm vụ nào ở mục “${TABS.find((t) => t.key === tab)?.label}”`}
          hint={
            tab === 'in_progress'
              ? 'Ra trang chủ và bấm “Nhận nhiệm vụ” để bắt đầu.'
              : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((s) => (
            <SubCard
              key={s.id}
              sub={s}
              targetUrl={targets[s.id] ?? null}
              onDone={() => void load()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
