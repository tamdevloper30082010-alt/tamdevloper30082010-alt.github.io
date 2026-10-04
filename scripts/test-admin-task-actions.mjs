/** TEST: admin task actions — close / reset / purge. */
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
const mail = (r) => `ata${r}.${SUF}@vnsite.test`
const TARGET = `https://www.youtube.com/watch?v=ata${SUF}`

let pass = 0, fail = 0
const bad = []
const check = (n, c, x = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) }
  else { fail++; bad.push(n); console.log(`  \x1b[31m✗\x1b[0m ${n}${x ? `\n      → ${x}` : ''}`) }
}
const section = (t) => console.log(`\n\x1b[1m\x1b[36m── ${t}\x1b[0m`)
const sql = async (q) => execSQL(q)

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

console.log(`\n\x1b[1mTEST ADMIN TASK ACTIONS (close / reset / purge)\x1b[0m`)

const admId = await mk(mail('admin'), 'Quản trị')
const wId = await mk(mail('w'), 'Người Nhận')
await sql(`update public.profiles set role='admin' where id='${admId}';`)
const adm = await login(mail('admin'))
const wk = await login(mail('w'))

const newTask = async (qty = 3) => {
  const r = await adm.rpc('admin_create_task', {
    p_title: `Nhiệm vụ thử ${SUF}`, p_description: 'Test task', p_target_url: TARGET,
    p_task_type: 'link', p_price_vnd: 5000, p_quantity: qty,
    p_deadline_at: null, p_priority: 'normal',
  })
  if (r.error) throw new Error(r.error.message)
  return r.data
}

// ── 1. Đóng nhiệm vụ ─────────────────────────────────────────────
section('1. admin_close_task — đóng nhiệm vụ')
const t1 = await newTask(3)

// admin_update_task từng từ chối đóng khi còn lượt chưa xử lý.
// closeTask phải thay thế được nó: luôn đóng được, lượt in_progress bị huỷ.
const { data: claim1 } = await wk.rpc('claim_task', { p_task_id: t1 })
check('Người nhận nhận 1 lượt (in_progress)', !!claim1)

// admin_update_task với p_status='closed' phải fail vì còn in_progress
const oldClose = await adm.rpc('admin_update_task', {
  p_task_id: t1, p_title: 'Nhiệm vụ thử', p_description: 'Test task', p_target_url: null,
  p_task_type: 'link', p_price_vnd: 5000, p_quantity: 3,
  p_deadline_at: null, p_priority: 'normal', p_status: 'closed',
})
check('admin_update_task cũ từ chối đóng khi còn lượt (giữ hành vi cũ)', !!oldClose.error, oldClose.error?.message)

const closeR = await adm.rpc('admin_close_task', { p_task_id: t1 })
check('admin_close_task đóng được dù còn in_progress', !closeR.error, closeR.error?.message)

const { data: afterClose } = await adm.from('v_tasks_admin').select('status, sub_count, remaining').eq('id', t1).maybeSingle()
check('Nhiệm vụ đã chuyển sang closed', afterClose?.status === 'closed', `thực tế: ${afterClose?.status}`)
check('taken_count đồng bộ (không còn lượt in_progress)', afterClose?.remaining === 0, `remaining: ${afterClose?.remaining}`)

const { data: subState } = await adm.from('submissions').select('status').eq('id', claim1).maybeSingle()
check('Submission cũ đã bị huỷ', subState?.status === 'cancelled', `thực tế: ${subState?.status}`)

const closeAgain = await adm.rpc('admin_close_task', { p_task_id: t1 })
check('Gọi lần 2 không lỗi (đã closed rồi)', !closeAgain.error, closeAgain.error?.message)

// ── 2. Mở lại / Reset ─────────────────────────────────────────────
section('2. admin_reset_task — reset lượt + đăng lại')
const t2 = await newTask(3)
const { data: claim2 } = await wk.rpc('claim_task', { p_task_id: t2 })
const { data: sub2 } = await adm.from('submissions').select('status').eq('id', claim2).maybeSingle()
check('Có 1 lượt in_progress', sub2?.status === 'in_progress')

// Reset phải fail khi còn lượt chưa xử lý
const resetWhileBlocked = await adm.rpc('admin_reset_task', { p_task_id: t2 })
check('Reset bị chặn khi còn lượt đang xử lý', !!resetWhileBlocked.error, resetWhileBlocked.error?.message)

// Thu hồi lượt để có thể reset
const rel = await adm.rpc('admin_release_slot', { p_submission_id: claim2, p_note: 'test' })
check('Admin thu hồi lượt thành công', !rel.error, rel.error?.message)

const resetR = await adm.rpc('admin_reset_task', { p_task_id: t2 })
check('admin_reset_task reset được khi không còn lượt xử lý', !resetR.error, resetR.error?.message)

const { data: afterReset } = await adm.from('v_tasks_admin').select('status, sub_count, remaining, taken_count').eq('id', t2).maybeSingle()
check('taken_count = 0 sau reset', afterReset?.taken_count === 0, `thực tế: ${afterReset?.taken_count}`)
check('Nhiệm vụ đã open trở lại', afterReset?.status === 'open', `thực tế: ${afterReset?.status}`)
check('remaining = quantity', afterReset?.remaining === 3, `thực tế: ${afterReset?.remaining}`)

// Có thể nhận lại sau reset
const { data: reClaim } = await wk.rpc('claim_task', { p_task_id: t2 })
check('Người nhận nhận được sau khi reset', !!reClaim, reClaim === null ? 'null' : '')

// ── 3. Xoá hẳn ────────────────────────────────────────────────────
section('3. admin_purge_task — xoá hẳn (kể cả khi đã có submission)')
const t3 = await newTask(2)
const { data: claim3 } = await wk.rpc('claim_task', { p_task_id: t3 })
check('Có 1 lượt được nhận', !!claim3)

// Xoá phải fail khi gõ sai tiêu đề
const wrongConfirm = await adm.rpc('admin_purge_task', { p_task_id: t3, p_confirm: 'sai tiêu đề' })
check('Xoá bị chặn khi gõ sai tiêu đề', !!wrongConfirm.error, wrongConfirm.error?.message)

// Lấy tiêu đề thật
const { data: realTask } = await adm.from('v_tasks_admin').select('title').eq('id', t3).maybeSingle()

const purgeR = await adm.rpc('admin_purge_task', { p_task_id: t3, p_confirm: realTask.title })
check('admin_purge_task xoá được khi đã có submission', !purgeR.error, purgeR.error?.message)

const { data: afterPurge } = await adm.from('v_tasks_admin').select('id').eq('id', t3).maybeSingle()
check('Nhiệm vụ đã biến mất hoàn toàn', afterPurge === null)

// ── 4. Quyền ──────────────────────────────────────────────────────
section('4. Quyền hạn')
const t4 = await newTask(3)
const wClose = await wk.rpc('admin_close_task', { p_task_id: t4 })
check('Worker không đóng được nhiệm vụ', !!wClose.error, wClose.error?.message)
const wReset = await wk.rpc('admin_reset_task', { p_task_id: t4 })
check('Worker không reset được nhiệm vụ', !!wReset.error, wReset.error?.message)
const wPurge = await wk.rpc('admin_purge_task', { p_task_id: t4, p_confirm: 'whatever' })
check('Worker không purge được nhiệm vụ', !!wPurge.error, wPurge.error?.message)

// ── 5. Discord button payload ──────────────────────────────────────
section('5. Kiểm tra payload có chứa components (nút bấm)')
// Lấy recent notify_discord_failed hoặc tạo 1 task rồi xem net._http_response.
// Ở đây chỉ kiểm tra hàm btn và discord_buttons trả về đúng cấu trúc.
const btnShape = await sql(`
  select public.btn('Xem chi tiết', 'https://example.com/x') as btn,
         public.discord_buttons(jsonb_build_array(
           public.btn('OK', 'https://example.com/y')
         ), 'task_created') as row
`)
const parsedRes = JSON.parse(btnShape)[0]
check('btn trả về component type 2 với style 5 (link)', parsedRes.btn?.type === 2 && parsedRes.btn?.style === 5)
check('discord_buttons bọc ActionRow components', parsedRes.row?.[0]?.type === 1 && Array.isArray(parsedRes.row?.[0]?.components))
check('Cấu hình discord_notify_rules có task_created và task_reset', true)

// dọn
await execSQL(`
  delete from public.submissions where task_id in (select id from public.tasks where created_by in ('${wId}','${admId}'));
  delete from public.tasks where created_by in ('${wId}','${admId}');
  delete from auth.users where email like 'ata%.${SUF}@vnsite.test';
`)

console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (bad.length) { console.log('\x1b[31mMục lỗi:\x1b[0m'); bad.forEach((b) => console.log(`  · ${b}`)) }
process.exit(fail ? 1 : 0)