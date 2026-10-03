/** Kiểm chứng sau khi bỏ luật "người đăng ký đầu là admin". */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { execSQL } from './db-run.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const S = env.VITE_SUPABASE_URL
const K = env.VITE_SUPABASE_PUBLISHABLE_KEY
const OWNER = 'huynhthanhtam2k10@gmail.com'
const PW = 'Kiemtra@123456'
const mail = `probe.${Date.now().toString(36).slice(-5)}@vnsite.test`

let bad = 0
const ok = (n, c, x = '') => {
  console.log(`  ${c ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${n}${!c && x ? ` → ${x}` : ''}`)
  if (!c) bad++
}
const sql = async (q) => JSON.parse(await execSQL(q))[0]

// Đăng ký tài khoản mới
const c = createClient(S, K, { auth: { persistSession: false } })
const { data: reg, error } = await c.auth.signUp({
  email: mail, password: PW, options: { data: { full_name: 'Người Thử' } },
})
if (error) { console.error('đăng ký lỗi:', error.message); process.exit(1) }
const UID = reg.user.id

// 1. không gọi được bootstrap
const { error: bootErr } = await c.rpc('bootstrap_first_admin', { p_full_name: 'A' })
ok('Người đăng ký mới KHÔNG gọi được bootstrap_first_admin', !!bootErr, 'gọi được!')

// 2. hồ sơ tự sinh, role = worker
const r1 = await sql(`select role from public.profiles where id = '${UID}'`)
ok('Hồ sơ được tạo tự động khi đăng ký', !!r1, 'không tìm thấy hồ sơ')
ok('Role mặc định là worker', r1?.role === 'worker', `thực tế: ${r1?.role}`)

// 3. tự sửa role qua REST bị chặn
const { error: updErr } = await c.from('profiles').update({ role: 'admin' }).eq('id', UID)
ok('Tự sửa role qua REST bị chặn', !!updErr)
const r2 = await sql(`select role from public.profiles where id = '${UID}'`)
ok('Role vẫn là worker sau khi thử sửa', r2?.role === 'worker', `thực tế: ${r2?.role}`)

// 4. không tạo được nhiệm vụ (cần admin)
const { error: tErr } = await c.rpc('admin_create_task', {
  p_title: 'Cố tạo', p_description: '', p_target_url: 'https://a.example/x',
  p_task_type: 'link', p_price_vnd: 5000, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
ok('Không tạo được nhiệm vụ', !!tErr)

// 5. chủ sở hữu vẫn là admin
const r3 = await sql(`select role from public.profiles where lower(email) = lower('${OWNER}')`)
ok(`Tài khoản ${OWNER} là admin`, r3?.role === 'admin', `thực tế: ${r3?.role}`)

// dọn
await execSQL(`
  delete from public.withdrawal_requests where user_id = '${UID}';
  delete from public.tasks where created_by = '${UID}';
  delete from auth.users where email = '${mail}';
`)

console.log(bad ? `\n\x1b[31m${bad} mục lỗi\x1b[0m` : '\n\x1b[32mTất cả tốt.\x1b[0m')
process.exit(bad ? 1 : 0)
