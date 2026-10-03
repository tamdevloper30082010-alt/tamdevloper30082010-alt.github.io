/** TEST: ẩn nhiệm vụ — gỡ khỏi danh sách mà không mất lịch sử tiền. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { execSQL } from './db-run.mjs'

const _f = globalThis.fetch
globalThis.fetch = async (i, o) => {
  let last
  for (let n = 1; n <= 6; n++) {
    try { return await _f(i, o) } catch (e) { last = e; await new Promise((s) => setTimeout(s, 800 * n)) }
  }
  throw last
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const S = env.VITE_SUPABASE_URL
const K = env.VITE_SUPABASE_PUBLISHABLE_KEY
const SUF = Date.now().toString(36).slice(-5)
const PW = 'Arche@123456'
const mail = (r) => `ar${r}.${SUF}@vnsite.test`
const TARGET = `https://www.youtube.com/watch?v=arch${SUF}`

let pass = 0, fail = 0
const bad = []
const check = (n, c, x = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) }
  else { fail++; bad.push(n); console.log(`  \x1b[31m✗\x1b[0m ${n}${x ? `\n      → ${x}` : ''}`) }
}
const section = (t) => console.log(`\n\x1b[1m\x1b[36m── ${t}\x1b[0m`)
const sql = async (q) => JSON.parse(await execSQL(q))[0]

async function retry(fn, label) {
  for (let a = 1; a <= 6; a++) {
    const r = await fn()
    if (!r.error || !/Service Unavailable|fetch failed/i.test(r.error.message)) return r
    if (a === 6) throw new Error(`${label}: ${r.error.message}`)
    await new Promise((s) => setTimeout(s, 3000 * a))
  }
}
async function mk(m, name) {
  const r = await retry(async () => {
    const c = createClient(S, K, { auth: { persistSession: false } })
    return c.auth.signUp({ email: m, password: PW, options: { data: { full_name: name } } })
  }, `đăng ký ${m}`)
  if (r.error) throw new Error(r.error.message)
  return r.data.user.id
}
async function login(m) {
  for (let a = 1; a <= 6; a++) {
    const sess = await retry(async () => {
      const c = createClient(S, K, { auth: { persistSession: false } })
      return c.auth.signInWithPassword({ email: m, password: PW })
    }, `đăng nhập ${m}`)
    if (sess.error) throw new Error(sess.error.message)
    const c = createClient(S, K, { auth: { persistSession: false } })
    const { error } = await c.auth.setSession({
      access_token: sess.data.session.access_token,
      refresh_token: sess.data.session.refresh_token,
    })
    if (!error) {
      const { data: chk } = await c.auth.getUser()
      if (chk?.user) return c
    }
    if (a === 6) throw new Error(`thiết lập phiên cho ${m} thất bại`)
    await new Promise((s) => setTimeout(s, 3000 * a))
  }
}

console.log(`\n\x1b[1mTEST ẨN NHIỆM VỤ\x1b[0m`)

const admId = await mk(mail('admin'), 'Quản trị')
const wId = await mk(mail('w'), 'Người Nhận')
await sql(`update public.profiles set role='admin' where id='${admId}';`)
const adm = await login(mail('admin'))
const wk = await login(mail('w'))

const newTask = async (qty = 3) => {
  const r = await adm.rpc('admin_create_task', {
    p_title: `Nhiệm vụ thử ${SUF}`, p_description: '', p_target_url: TARGET,
    p_platform: 'youtube', p_price_vnd: 5000, p_quantity: qty,
    p_deadline_at: null, p_priority: 'normal',
  })
  if (r.error) throw new Error(r.error.message)
  return r.data
}

// ── 1. Bảng tin ───────────────────────────────────────────────────
section('1. Bảng tin chỉ hiện nhiệm vụ còn nhận được')
const t1 = await newTask(3)
const { data: board1 } = await wk.from('v_tasks').select('*').eq('id', t1).maybeSingle()
check('Nhiệm vụ mới xuất hiện trên bảng tin', !!board1)

// Nhiệm vụ "đóng" đúng nghĩa là ĐÃ ĐỦ NGƯỜI NHẬN — không phải admin bấm tắt.
// Nên phải cho người nhận lấy hết các lượt.
const t1b = await newTask(1)
await wk.rpc('claim_task', { p_task_id: t1b })
const { data: board2 } = await wk.from('v_tasks').select('*').eq('id', t1b).maybeSingle()
check('Nhiệm vụ đã đủ người nhận biến mất khỏi bảng tin', board2 === null, `vẫn thấy: ${JSON.stringify(board2)?.slice(0, 80)}`)

const { data: closedView } = await wk.from('v_tasks_closed').select('*').eq('id', t1b).maybeSingle()
check('Nhưng vẫn xem được ở view "nhiệm vụ đã đóng"', !!closedView)

const { data: adminView } = await adm.from('v_tasks_admin').select('*').eq('id', t1b).maybeSingle()
check('Admin vẫn thấy nhiệm vụ ở trang quản trị', !!adminView)

// Còn lượt thì bấm "Đóng" cũng phải biến mất khỏi bảng tin
await adm.rpc('admin_update_task', {
  p_task_id: t1, p_title: 'Nhiệm vụ thử', p_description: '', p_target_url: null,
  p_platform: 'youtube', p_price_vnd: 5000, p_quantity: 3,
  p_deadline_at: null, p_priority: 'normal', p_status: 'closed',
})
const { data: board3 } = await wk.from('v_tasks').select('*').eq('id', t1).maybeSingle()
check('Admin bấm Đóng khi còn lượt → cũng rời khỏi bảng tin', board3 === null, 'vẫn còn trên bảng tin')

// ── 2. Ẩn ────────────────────────────────────────────────────────
section('2. Ẩn nhiệm vụ đã có người nhận')
const t2 = await newTask(1)
const { data: sub } = await wk.rpc('claim_task', { p_task_id: t2 })
check('Người nhận nhận được lượt', !!sub)

const preDel = await adm.rpc('admin_delete_task', { p_task_id: t2 })
check('Xoá hẳn bị chặn (đã có người nhận)', !!preDel.error, preDel.error?.message)

const ar = await adm.rpc('admin_archive_task', { p_task_id: t2, p_archive: true })
check('Ẩn vẫn làm được dù đã có người nhận', !ar.error, ar.error?.message)

const { data: afterArch } = await adm.from('v_tasks_admin').select('archived_at, sub_count').eq('id', t2).maybeSingle()
check('Ghi nhận đã ẩn', !!afterArch?.archived_at)
check('Số lượt người nhận vẫn còn trong hồ sơ', afterArch?.sub_count === 1, `thực tế: ${afterArch?.sub_count}`)

const { data: subStill } = await adm.from('submissions').select('id').eq('id', sub)
check('Lượt của người nhận không bị mất', (subStill ?? []).length === 1)

const claimAfter = await wk.rpc('claim_task', { p_task_id: t2 })
check('Không ai nhận được nhiệm vụ đã ẩn', !!claimAfter.error, claimAfter.error?.message)

// ── 3. Bỏ ẩn ─────────────────────────────────────────────────────
section('3. Bỏ ẩn')
const un = await adm.rpc('admin_archive_task', { p_task_id: t2, p_archive: false })
check('Bỏ ẩn thành công', !un.error, un.error?.message)
const t3 = await newTask(2)
await adm.rpc('admin_archive_task', { p_task_id: t3, p_archive: true })
await adm.rpc('admin_archive_task', { p_task_id: t3, p_archive: false })
const { data: back } = await adm.from('v_tasks').select('id').eq('id', t3).maybeSingle()
check('Nhiệm vụ bỏ ẩn quay lại bảng tin', !!back)

// ── 4. Xoá nhiệm vụ chưa ai nhận ─────────────────────────────────
section('4. Xoá nhiệm vụ chưa ai nhận')
const t4 = await newTask(5)
const del = await adm.rpc('admin_delete_task', { p_task_id: t4 })
check('Xoá hẳn nhiệm vụ chưa ai nhận được', !del.error, del.error?.message)
const { data: gone } = await adm.from('v_tasks_admin').select('id').eq('id', t4).maybeSingle()
check('Nhiệm vụ đã bị xoá hẳn', gone === null)

const t5 = await newTask(2)
const claimOwn = await adm.rpc('claim_task', { p_task_id: t5 })
check('Admin không nhận được nhiệm vụ do mình tạo', !!claimOwn.error)
const del2 = await adm.rpc('admin_delete_task', { p_task_id: t5 })
check('Xoá nhiệm vụ chưa ai nhận vẫn được', !del2.error, del2.error?.message)

// ── 5. Quyền ─────────────────────────────────────────────────────
section('5. Quyền hạn')
const wArch = await wk.rpc('admin_archive_task', { p_task_id: t1, p_archive: true })
check('Worker không ẩn được nhiệm vụ', !!wArch.error, wArch.error?.message)
const wDel = await wk.rpc('admin_delete_task', { p_task_id: t1 })
check('Worker không xoá được nhiệm vụ', !!wDel.error, wDel.error?.message)

// dọn
await execSQL(`
  delete from public.withdrawal_requests where user_id in ('${wId}','${admId}');
  delete from public.submissions where task_id in (select id from public.tasks where created_by in ('${wId}','${admId}'));
  delete from public.tasks where created_by in ('${wId}','${admId}');
  delete from auth.users where email like 'ar%.${SUF}@vnsite.test';
`)

console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (bad.length) { console.log('\x1b[31mMục lỗi:\x1b[0m'); bad.forEach((b) => console.log(`  · ${b}`)) }
process.exit(fail ? 1 : 0)
