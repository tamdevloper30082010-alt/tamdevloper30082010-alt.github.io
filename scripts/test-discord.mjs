/**
 * BỘ TEST — THÔNG BÁO DISCORD
 *
 * Chạy bằng PUBLISHABLE KEY, giống hệt trình duyệt thật.
 *
 * Test này KHÔNG kiểm tra nội dung tin nhắn Discord (cần đọc kênh, tức là
 * cần bot). Nó kiểm tra điều quan trọng hơn: nghiệp vụ CÓ chạy và có bắn
 * hàng đợi HTTP đi, đồng thời Discord KHÔNG được làm hỏng nghiệp vụ.
 *
 * Dùng:  node scripts/test-discord.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const SB_URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const SUFFIX = Date.now().toString(36).slice(-5)
const PW = 'Test@123456'

const _fetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  let last
  for (let i = 1; i <= 6; i++) {
    try { return await _fetch(input, init) } catch (e) {
      last = e; await new Promise((s) => setTimeout(s, 800 * i))
    }
  }
  throw last
}

let pass = 0, fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra ? `\n      → ${extra}` : ''}`) }
}
const section = (t) => console.log(`\n\x1b[1m\x1b[36m── ${t}\x1b[0m`)

async function register(email, name) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signUp({ email, password: PW, options: { data: { full_name: name } } })
  if (error) throw new Error(`đăng ký ${email} thất bại: ${error.message}`)
  return { client: c, session: data.session }
}
async function signIn(email) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`đăng nhập thất bại: ${error.message}`)
  return c
}
const emailOf = (r) => `dc${r}.${SUFFIX}@vnsite.test`

console.log(`\n\x1b[1mBỘ TEST THÔNG BÁO DISCORD — ref ${SB_URL.split('//')[1].split('.')[0]}\x1b[0m`)


// ── 1. Cấu hình ───────────────────────────────────────────
section('1. Cấu hình trong Vault')
const { execSQL } = await import('./db-run.mjs')

// audit_log là append-only, lỗi của lần chạy trước vẫn nằm đó. Chụp mốc
// trước rồi so sánh, nếu không sẽ báo lỗi oan.
const failBefore = Number(JSON.parse(await execSQL(
  `select count(*)::int n from public.audit_log where action='discord_notify_failed';`))[0].n)
const secrets = JSON.parse(await execSQL(`
  select name from vault.decrypted_secrets order by name;`))
const names = secrets.map((r) => r.name)
check('Đã cất discord_webhook_url', names.includes('discord_webhook_url'), String(names))
check('Đã cất discord_role_id', names.includes('discord_role_id'), String(names))

const ruleRows = JSON.parse(await execSQL(`
  select event, enabled, mention from public.discord_notify_rules order by event;`))
check('Có bảng cấu hình 7 loại thông báo', ruleRows.length === 7, `thực tế: ${ruleRows.length}`)
check('Mặc định chỉ "task_created" ping role',
  ruleRows.filter((r) => r.mention).map((r) => r.event).join() === 'task_created',
  ruleRows.filter((r) => r.mention).map((r) => r.event).join())

// ── 2. Không ai gọi được hàm gửi tin từ trình duyệt ───────
section('2. Không spam được Discord từ trình duyệt')
const anon = createClient(SB_URL, KEY, { auth: { persistSession: false } })
const { error: anonCall } = await anon.rpc('notify_discord', {
  p_event: 'task_created', p_title: 'Tin giả', p_body: 'spam', p_fields: {}, p_ok: true,
})
check('Khách (chưa đăng nhập) gọi notify_discord → bị chặn', !!anonCall, 'gọi được — lỗ hổng!')

const w = await register(emailOf('w1'), 'Người Nhận Test')
const wc = await signIn(emailOf('w1'))
const { error: workerCall } = await wc.rpc('notify_discord', {
  p_event: 'task_created', p_title: 'Tin giả', p_body: 'spam', p_fields: {}, p_ok: true,
})
check('Worker đã đăng nhập gọi notify_discord → bị chặn', !!workerCall, 'gọi được — lỗ hổng!')

const { error: readSecret } = await wc.rpc('discord_secret', { p_name: 'discord_webhook_url' })
check('Worker đọc được bí mật Vault? → bị chặn', !!readSecret, 'đọc được URL webhook — lỗ hổng!')

// ── 3. Nghiệp vụ vẫn chạy ─────────────────────────────────
section('3. Nghiệp vụ chạy và bắn thông báo')
const admin = await register(emailOf('adm'), 'Quản trị Discord')
await execSQL(`update public.profiles set role='admin' where id='${admin.session.user.id}';`)
const adm = await signIn(emailOf('adm'))

const { data: taskId, error: cErr } = await adm.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ kiểm thử thông báo',
  p_description: 'Đây là nhiệm vụ chỉ dùng để thử thông báo Discord',
  p_target_url: `https://www.youtube.com/watch?v=dc${SUFFIX}`,
  p_task_type: 'link', p_price_vnd: 4500, p_quantity: 2,
  p_deadline_at: null, p_priority: 'normal',
})
check('Admin vẫn đăng được nhiệm vụ', !!taskId && !cErr, cErr?.message)

const { data: subId, error: claimErr } = await wc.rpc('claim_task', { p_task_id: taskId })
check('Worker vẫn nhận được lượt', !!subId && !claimErr, claimErr?.message)

const { error: subErr } = await wc.rpc('submit_result', {
  p_submission_id: subId, p_result_url: `https://vnsite.test/dc/${SUFFIX}`,
  p_note: '', p_evidence_path: null,
})
check('Worker vẫn nộp được thành quả', !subErr, subErr?.message)

const { error: revErr } = await adm.rpc('admin_review_submission', {
  p_submission_id: subId, p_approve: true, p_note: '',
})
check('Admin vẫn duyệt được thành quả', !revErr, revErr?.message)

const { error: adjErr } = await adm.rpc('admin_adjust_balance', {
  p_user_id: w.session.user.id, p_amount_vnd: -2000, p_note: 'Kiểm thử đẩy âm',
})
check('Điều chỉnh số dư âm vẫn chạy', !adjErr, adjErr?.message)

// ── 4. Hàng đợi HTTP đã bắn ra chưa ────────────────────────
section('4. Hàng đợi HTTP')
await new Promise((r) => setTimeout(r, 12000))
const sent = JSON.parse(await execSQL(`
  select count(*)::int as n from net._http_response
   where status_code between 200 and 299;`))[0]?.n
check('pg_net đã bắn tin thành công ra Discord', Number(sent) > 0, `thành công: ${sent}`)

const errs = JSON.parse(await execSQL(`
  select count(*)::int as n from net._http_response
   where status_code is null or status_code >= 400;`))[0]?.n
check('Không có lỗi HTTP nào', Number(errs) === 0, `lỗi: ${errs}`)

const failAfter = Number(JSON.parse(await execSQL(`
  select count(*)::int as n from public.audit_log where action='discord_notify_failed';`))[0].n)
const notifFail = failAfter - failBefore
check('Không có lỗi gửi nào mới bị ghi nhật', notifFail === 0, `lỗi mới: ${notifFail}`)

console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (failures.length) { console.log('\x1b[31mCác mục lỗi:\x1b[0m'); failures.forEach((f) => console.log(`  · ${f}`)) }
if (process.env.KEEP_TEST_DATA !== '1') {
  await execSQL(`
    delete from public.tasks
     where created_by in (select id from public.profiles where email like '%@vnsite.test');
    delete from auth.users where email like '%@vnsite.test';`)
  console.log('\nĐã dọn dữ liệu test.')
}
process.exit(fail ? 1 : 0)
