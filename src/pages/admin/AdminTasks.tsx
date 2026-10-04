import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../../components/Toast'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  cx,
} from '../../components/ui'
import { supabase, errMessage } from '../../lib/supabase'
import {
  MIN_PRICE,
  formatVnd,
  isValidPrice,
  parseVnd,
  priceHint,
  stripSeparators,
  validateQuantity,
} from '../../lib/money'
import { TASK_TYPE_LABEL, TASK_TYPE_STYLE, type Task, type TaskType } from '../../lib/types'

const TASK_TYPES: TaskType[] = ['link', 'other']

type Filter = 'live' | 'closed' | 'archived' | 'all'
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'live', label: 'Đang mở' },
  { k: 'closed', label: 'Đã đóng' },
  { k: 'archived', label: 'Đã ẩn' },
  { k: 'all', label: 'Tất cả' },
]

const blank = {
  title: '',
  description: '',
  target_url: '',
  task_type: 'link' as TaskType,
  price: '',
  quantity: '10',
  deadline: '',
  priority: 'normal' as 'normal' | 'hot',
}
type Form = typeof blank

function fromTask(t: Task): Form {
  return {
    title: t.title,
    description: t.description,
    target_url: '', // không đọc được từ view; admin xem ở hàng đợi duyệt
    task_type: t.task_type,
    price: String(t.price_vnd),
    quantity: String(t.quantity),
    deadline: t.deadline_at ? new Date(t.deadline_at).toISOString().slice(0, 16) : '',
    priority: t.priority,
  }
}

export default function AdminTasks() {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [form, setForm] = useState<Form>(blank)
  const [errs, setErrs] = useState<Partial<Record<keyof Form, string>>>({})
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>('live')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_tasks_admin')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) return toast(errMessage(error, 'Không tải được danh sách nhiệm vụ.'), 'err')
    setTasks((data as Task[]) ?? [])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const open = (t: Task | 'new') => {
    setErrs({})
    setForm(t === 'new' ? blank : fromTask(t))
    setEditing(t)
  }

  const validate = (): Partial<Record<keyof Form, string>> => {
    const e: Partial<Record<keyof Form, string>> = {}
    if (form.title.trim().length < 3) e.title = 'Tiêu đề ít nhất 3 ký tự.'

    // Vượt link thì bắt buộc có link; nhiệm vụ khác thì link là vô nghĩa —
    // người nhận sẽ nộp ảnh chứng minh nên phải có mô tả rõ công việc.
    if (form.task_type === 'link') {
      if (editing === 'new' && !/^https?:\/\/\S+$/i.test(form.target_url.trim()))
        e.target_url = 'Link phải bắt đầu bằng http:// hoặc https://'
    } else if (form.description.trim().length < 10) {
      e.description = 'Nhiệm vụ khác cần mô tả công việc (tối thiểu 10 ký tự).'
    }

    if (!isValidPrice(form.price)) e.price = priceHint()
    if (!validateQuantity(Number(form.quantity))) e.quantity = 'Số lượt từ 1 đến 10.000.'
    setErrs(e)
    return e
  }

  const save = async () => {
    if (!editing) return
    if (Object.keys(validate()).length) return

    const price = parseVnd(form.price)!
    const qty = Number(form.quantity)
    const deadline = form.deadline ? new Date(form.deadline).toISOString() : null
    // Nhiệm vụ khác không có link nào để vượt — gửi rỗng xuống cho sạch.
    const targetUrl = form.task_type === 'link' ? form.target_url.trim() : ''

    setBusy(true)
    const { error } =
      editing === 'new'
        ? await supabase.rpc('admin_create_task', {
            p_title: form.title,
            p_description: form.description,
            p_target_url: targetUrl,
            p_task_type: form.task_type,
            p_price_vnd: price,
            p_quantity: qty,
            p_deadline_at: deadline,
            p_priority: form.priority,
          })
        : await supabase.rpc('admin_update_task', {
            p_task_id: editing.id,
            p_title: form.title,
            p_description: form.description,
            p_target_url: targetUrl || null,
            p_task_type: form.task_type,
            p_price_vnd: price,
            p_quantity: qty,
            p_deadline_at: deadline,
            p_priority: form.priority,
            p_status: 'open',
          })

    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast(editing === 'new' ? 'Đã đăng nhiệm vụ lên trang chủ.' : 'Đã cập nhật nhiệm vụ.', 'ok')
    setEditing(null)
    void load()
  }

  const del = async (t: Task) => {
    if (!confirm(`Xoá hẳn nhiệm vụ “${t.title}”?\n\nNhiệm vụ này chưa có ai nhận nên xoá được.`))
      return
    setBusy(true)
    const { error } = await supabase.rpc('admin_delete_task', { p_task_id: t.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã xoá nhiệm vụ.', 'ok')
    void load()
  }

  // ẨN — luôn dùng được, kể cả khi đã có người nhận. Lịch sử tiền giữ nguyên.
  const toggleArchive = async (t: Task) => {
    const archiving = !t.archived_at
    if (archiving && !confirm(`Ẩn “${t.title}” khỏi danh sách?\n\nNhiệm vụ sẽ không còn ai nhận được, nhưng lịch sử người đã làm vẫn được giữ.`))
      return
    setBusy(true)
    const { error } = await supabase.rpc('admin_archive_task', {
      p_task_id: t.id,
      p_archive: archiving,
    })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast(archiving ? 'Đã ẩn khỏi danh sách.' : 'Đã đưa nhiệm vụ trở lại danh sách.', 'ok')
    void load()
  }

  // ĐÓNG — luôn dùng được, kể cả khi còn lượt in_progress (sẽ bị huỷ trả về kho).
  // Gọi admin_close_task thay cho admin_update_task vì admin_update_task từ
  // chối đóng khi còn submission chưa xử lý xong.
  const closeTask = async (t: Task) => {
    if (!confirm(`Đóng nhiệm vụ “${t.title}”?\n\nCác lượt đang làm sẽ bị huỷ và trả về kho. Lượt chờ duyệt vẫn được giữ để admin duyệt tiếp.`))
      return
    setBusy(true)
    const { error } = await supabase.rpc('admin_close_task', { p_task_id: t.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã đóng nhiệm vụ.', 'ok')
    void load()
  }

  // MỞ LẠI & ĐĂNG LẠI — reset taken_count về 0, gửi lại thông báo Discord
  // kèm nút "Nhận nhiệm vụ" để mọi người bấm vào nhận. Nhiệm vụ cũ phải đã
  // xử lý xong tất cả submission (không còn chờ duyệt / đang làm / bị từ chối).
  const reopenTask = async (t: Task) => {
    if (!confirm(`Mở lại và đăng lại nhiệm vụ “${t.title}”?\n\nLượt nhận sẽ được reset về 0 và thông báo Discord sẽ được gửi lại.\n\nLưu ý: phải duyệt/từ chối/thu hồi hết các lượt đang chờ trước.`))
      return
    setBusy(true)
    const { error } = await supabase.rpc('admin_reset_task', { p_task_id: t.id })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã mở lại và đăng lại nhiệm vụ.', 'ok')
    void load()
  }

  // XOÁ HẲN — kể cả khi đã có lượt nhận / đã duyệt tiền. Bắt buộc gõ lại
  // đúng tiêu đề để chặn click nhầm.
  const hardDelete = async (t: Task) => {
    const typed = prompt(
      `Xoá HẲN nhiệm vụ “${t.title}” khỏi hệ thống?\n\n` +
      'Tất cả lượt đã nhận sẽ bị xoá theo. Tiền đã trả cho người nhận KHÔNG được hoàn lại.\n\n' +
      `Gõ lại chính xác tiêu đề nhiệm vụ để xác nhận:`
    )
    if (typed === null) return
    if (typed.trim() !== t.title) {
      toast('Tiêu đề không khớp, đã huỷ thao tác.', 'err')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('admin_purge_task', {
      p_task_id: t.id,
      p_confirm: typed,
    })
    setBusy(false)
    if (error) return toast(errMessage(error), 'err')
    toast('Đã xoá hẳn nhiệm vụ.', 'ok')
    void load()
  }

  const counts = useMemo(
    () => ({
      all: tasks.length,
      live: tasks.filter((t) => !t.archived_at && t.remaining > 0).length,
      closed: tasks.filter((t) => !t.archived_at && t.remaining <= 0).length,
      archived: tasks.filter((t) => t.archived_at).length,
    }),
    [tasks],
  )

  const list = tasks.filter((t) => {
    if (filter === 'archived') return !!t.archived_at
    if (t.archived_at) return false
    if (filter === 'live') return t.remaining > 0
    if (filter === 'closed') return t.remaining <= 0
    return true
  })

  if (loading) return <Spinner label="Đang tải…" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Quản lý nhiệm vụ</h1>
          <p className="mt-1 text-sm text-muted">Đăng nhiệm vụ và đặt mức thưởng VND.</p>
        </div>
        <Button onClick={() => open('new')} size="lg">
          + Đăng nhiệm vụ
        </Button>
      </div>

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
        <Empty
          title={filter === 'archived' ? 'Chưa ẩn nhiệm vụ nào' : 'Không có nhiệm vụ nào'}
          hint={
            filter === 'live'
              ? 'Bấm “Đăng nhiệm vụ” để tạo nhiệm vụ đầu tiên.'
              : filter === 'archived'
                ? 'Nhiệm vụ đã gỡ khỏi danh sách sẽ nằm ở đây.'
                : undefined
          }
          action={
            filter === 'live' ? (
              <Button onClick={() => open('new')}>+ Đăng nhiệm vụ</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Bảng — từ md trở lên */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line/10 text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nhiệm vụ</th>
                  <th className="px-4 py-3 font-semibold">Thưởng</th>
                  <th className="px-4 py-3 font-semibold">Lượt</th>
                  <th className="px-4 py-3 font-semibold">Trạng thái</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/8">
                {list.map((t) => {
                  const taken = (t.sub_count ?? 0) > 0
                  return (
                    <tr key={t.id} className="hover:bg-line/4">
                      <td className="max-w-xs px-4 py-3">
                        <div className="truncate font-semibold">{t.title}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <Badge className={TASK_TYPE_STYLE[t.task_type]}>
                            {TASK_TYPE_LABEL[t.task_type]}
                          </Badge>
                          {t.archived_at && (
                            <Badge className="bg-muted/15 text-muted">ĐÃ ẨN</Badge>
                          )}
                        </div>
                      </td>
                      <td className="money px-4 py-3 font-bold text-money">
                        {formatVnd(t.price_vnd)}
                      </td>
                      <td className="money px-4 py-3">
                        {t.taken_count}/{t.quantity}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cx(
                            'text-xs font-bold',
                            t.archived_at
                              ? 'text-muted'
                              : t.remaining > 0
                                ? 'text-accent'
                                : 'text-warn',
                          )}
                        >
                          {t.archived_at ? 'Đã ẩn' : t.remaining > 0 ? 'Đang mở' : 'Đã đóng'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => open(t)}>
                            Sửa
                          </Button>
                          {!t.archived_at && t.remaining > 0 && (
                            <Button size="sm" variant="subtle" onClick={() => closeTask(t)}>
                              Đóng
                            </Button>
                          )}
                          {!t.archived_at && t.remaining <= 0 && (
                            <Button size="sm" variant="subtle" onClick={() => reopenTask(t)}>
                              Mở lại
                            </Button>
                          )}
                          <Button size="sm" variant="subtle" onClick={() => toggleArchive(t)}>
                            {t.archived_at ? 'Bỏ ẩn' : 'Ẩn'}
                          </Button>
                          {!taken && !t.archived_at && (
                            <Button size="sm" variant="ghost" onClick={() => del(t)}>
                              Xoá
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:bg-danger/10"
                            onClick={() => hardDelete(t)}
                          >
                            Xoá hẳn
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          {/* Card — cho điện thoại */}
          <div className="space-y-3 md:hidden">
            {list.map((t) => {
              const taken = (t.sub_count ?? 0) > 0
              return (
                <Card key={t.id} className={cx('p-4', t.archived_at && 'opacity-70')}>
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <Badge className={TASK_TYPE_STYLE[t.task_type]}>
                      {TASK_TYPE_LABEL[t.task_type]}
                    </Badge>
                    {t.priority === 'hot' && (
                      <Badge className="bg-danger/15 text-danger">🔥 ƯU TIÊN</Badge>
                    )}
                    <Badge
                      className={
                        t.archived_at
                          ? 'bg-muted/15 text-muted'
                          : t.remaining > 0
                            ? 'bg-accent/15 text-accent'
                            : 'bg-warn/15 text-warn'
                      }
                    >
                      {t.archived_at
                        ? 'Đã ẩn'
                        : t.remaining > 0
                          ? `Còn ${t.remaining} lượt`
                          : 'Đã đóng'}
                    </Badge>
                  </div>
                  <h3 className="text-sm leading-snug font-bold">{t.title}</h3>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="money text-money text-lg font-bold">
                      {formatVnd(t.price_vnd)}
                    </span>
                    <span className="money text-xs text-muted">
                      {t.taken_count}/{t.quantity} lượt
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="md" variant="outline" className="flex-1" onClick={() => open(t)}>
                      Sửa
                    </Button>
                    {!t.archived_at && t.remaining > 0 && (
                      <Button size="md" variant="subtle" className="flex-1" onClick={() => closeTask(t)}>
                        Đóng
                      </Button>
                    )}
                    {!t.archived_at && t.remaining <= 0 && (
                      <Button size="md" variant="subtle" className="flex-1" onClick={() => reopenTask(t)}>
                        Mở lại
                      </Button>
                    )}
                    <Button size="md" variant="subtle" className="flex-1" onClick={() => toggleArchive(t)}>
                      {t.archived_at ? 'Bỏ ẩn' : 'Ẩn'}
                    </Button>
                    {!taken && !t.archived_at && (
                      <Button size="md" variant="ghost" className="flex-1" onClick={() => del(t)}>
                        Xoá
                      </Button>
                    )}
                    <Button
                      size="md"
                      variant="ghost"
                      className="flex-1 text-danger hover:bg-danger/10"
                      onClick={() => hardDelete(t)}
                    >
                      Xoá hẳn
                    </Button>
                  </div>

                  {taken && !t.archived_at && (
                    <p className="mt-2.5 text-[11px] leading-snug text-muted">
                      Đã có {t.sub_count} lượt được nhận — dùng <b>Ẩn</b> để gỡ khỏi danh sách
                      (lịch sử giữ nguyên) hoặc <b>Xoá hẳn</b> để xoá hoàn toàn.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Form */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title={editing === 'new' ? 'Đăng nhiệm vụ mới' : 'Sửa nhiệm vụ'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Huỷ
            </Button>
            <Button loading={busy} onClick={save}>
              {editing === 'new' ? 'Đăng lên trang chủ' : 'Lưu thay đổi'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Loại nhiệm vụ" required>
            <Select
              value={form.task_type}
              onChange={(e) => {
                const task_type = e.target.value as TaskType
                setForm({ ...form, task_type })
                setErrs({ ...errs, target_url: undefined, description: undefined })
              }}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>

          <p className="rounded-xl border border-line/12 bg-line/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-muted">
            {form.task_type === 'link' ? (
              <>
                Người nhận vượt link rồi dán link kết quả. Không bắt buộc gửi ảnh.
              </>
            ) : (
              <>
                Người nhận làm theo mô tả rồi <b className="text-fg">chụp ảnh</b> làm
                bằng chứng. Ảnh sẽ bị xoá khỏi hệ thống ngay khi bạn bấm Duyệt để tiết kiệm
                dung lượng.
              </>
            )}
          </p>

          <Field label="Tiêu đề" required error={errs.title}>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              invalid={!!errs.title}
              placeholder={
                form.task_type === 'link'
                  ? 'Vượt video YouTube — kênh ABC'
                  : 'Chụp ảnh hàng đã nhận — shop MINH AN'
              }
            />
          </Field>

          <Field
            label="Mô tả nhiệm vụ"
            required={form.task_type === 'other'}
            error={errs.description}
            hint={
              form.task_type === 'other'
                ? 'Bắt buộc với nhiệm vụ khác — đây là thứ duy nhất người nhận biết phải làm gì.'
                : 'Hướng dẫn cụ thể cho người nhận nhiệm vụ'
            }
          >
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              invalid={!!errs.description}
              placeholder={
                form.task_type === 'link'
                  ? 'Xem hết video, không tắt quảng cáo…'
                  : 'Chụp ảnh toàn bộ màn hình đơn hàng sau khi nhận, chụp rõ mã đơn…'
              }
            />
          </Field>

          {form.task_type === 'link' && (
            <Field
              label="Link cần vượt"
              required={editing === 'new'}
              error={errs.target_url}
              hint={
                editing === 'new'
                  ? 'Chỉ hiện với người đã nhận nhiệm vụ.'
                  : 'Để trống nếu không muốn đổi link.'
              }
            >
              <Input
                value={form.target_url}
                onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                invalid={!!errs.target_url}
                placeholder="https://youtube.com/watch?v=…"
                inputMode="url"
              />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Thưởng mỗi lượt (VND)"
              required
              error={errs.price}
              hint={`Nhập bao nhiêu cũng được, từ ${formatVnd(MIN_PRICE)} trở lên`}
            >
              <Input
                value={form.price}
                onChange={(e) =>
                  setForm({ ...form, price: stripSeparators(e.target.value).slice(0, 9) })
                }
                invalid={!!errs.price}
                placeholder="5000"
                inputMode="numeric"
                className="money font-bold"
              />
            </Field>

            <Field label="Số lượt cần" required error={errs.quantity}>
              <Input
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: stripSeparators(e.target.value).slice(0, 5) })
                }
                invalid={!!errs.quantity}
                inputMode="numeric"
                className="money"
              />
            </Field>

            <Field label="Hạn nộp" hint="Để trống = không hạn">
              <Input
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Mức ưu tiên">
            <Select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as 'normal' | 'hot' })}
            >
              <option value="normal">Bình thường</option>
              <option value="hot">Ưu tiên cao</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  )
}
