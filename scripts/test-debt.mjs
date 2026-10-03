/**
 * BỘ TEST — ĐIỀU CHỈNH SỐ DƯ ÂM VÀ BÙ NỢ
 *
 * Chạy bằng PUBLISHABLE KEY, giống hệt trình duyệt thật.
 *
 * Bốn thứ cần chứng minh:
 *   1. Admin trừ được số dư (nhập số âm) — và nhập số âm làm ví âm.
 *   2. Ví âm thì rút tiền bị chặn, thông báo nói đúng chuyện gì cần làm.
 *   3. Kiếm nhiệm vụ bù lên 0 là rút được trở lại — không cần admin xoá tay.
 *   4. Sổ cái vẫn là append-only: không sửa/xoá được dòng cũ.
 *
 * Dùng:  node scripts/test-debt.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const SB_URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const SUFFIX = Date.now().toString(36).slice(-5)
const PW = 'Test@123456'

// Môi trường CI hay bị reset TLS ngẫu nhiên → thử lại thay vì báo lỗi giả
const _fetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  let last
  for (let i = 1; i <= 6; i++) {
    try {
      return await _fetch(input, init)
    } catch (e) {
      last = e
      await new Promise((s) => setTimeout(s, 800 * i))
    }
  }
  throw last
}

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra ? `\n      → ${extra}` : ''}`)
  }
}

function section(t) {
  console.log(`\n\x1b[1m\x1b[36m── ${t}\x1b[0m`)
}

async function register(email, name) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signUp({
    email,
    password: PW,
    options: { data: { full_name: name } },
  })
  if (error) throw new Error(`đăng ký ${email} thất bại: ${error.message}`)
  return { client: c, session: data.session }
}

async function signIn(email) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`đăng nhập ${email} thất bại: ${error.message}`)
  return c
}

const emailOf = (r) => `debt${r}.${SUFFIX}@vnsite.test`
const bank = (o = {}) => ({
  p_method: 'bank',
  p_amount_vnd: 10000,
  p_bank_code: '970436',
  p_bank_holder: 'Nguyễn Test',
  p_bank_number: '0123456789',
  p_game_platform: '',
  p_game_account_id: '',
  p_card_brand: '',
  p_note: '',
  ...o,
})

const bal = async (c, id) => {
  const { data } = await c.from('v_wallet').select('balance_vnd').eq('user_id', id).single()
  return Number(data?.balance_vnd ?? 0)
}

console.log(`\n\x1b[1mBỘ TEST NỢ & BÙ NỢ — ref ${SB_URL.split('//')[1].split('.')[0]}\x1b[0m`)

// ── 1. Tài khoản ─────────────────────────────────────────────
section('1. Tài khoản')

const admin = await register(emailOf('adm'), 'Quản trị Nợ')
const { execSQL } = await import('./db-run.mjs')
await execSQL(`update public.profiles set role='admin' where id='${admin.session.user.id}';`)

const adminClient = await signIn(emailOf('adm'))
const w = await register(emailOf('w1'), 'Người Nợ Nợ')
const wc = await signIn(emailOf('w1'))
const wid = w.session.user.id

// ── 2. Cộng trước rồi trừ ─────────────────────────────────────
section('2. Điều chỉnh số dư hai chiều')

const { error: upErr } = await adminClient.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: 100000,
  p_note: 'Nạp thử nghiệm',
})
check('Cộng tiền thành công', !upErr, upErr?.message)
check('Số dư = 100.000', (await bal(wc, wid)) === 100000)

const { error: downErr } = await adminClient.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: -60000,
  p_note: 'Trừ do hoàn tiền sai',
})
check('TRỪ tiền bằng số âm thành công', !downErr, downErr?.message)
check('Số dư = 40.000', (await bal(wc, wid)) === 40000, `thực tế: ${await bal(wc, wid)}`)

const { error: zeroErr } = await adminClient.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: 0,
  p_note: 'Điều chỉnh 0',
})
check('Điều chỉnh 0 ₫ → bị chặn', !!zeroErr)

const { error: noReason } = await adminClient.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: -1000,
  p_note: 'x',
})
check('Trừ mà không nêu lý do → bị chặn', !!noReason)

const { error: workerAdj } = await wc.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: 999999,
  p_note: 'tự cộng tiền cho mình',
})
check('Worker KHÔNG tự điều chỉnh số dư được', !!workerAdj, 'tự cộng tiền được — lỗ hổng!')

// ── 3. Đẩy ví xuống dưới 0 ───────────────────────────────────
section('3. Ví âm và rút tiền')

const { error: negErr } = await adminClient.rpc('admin_adjust_balance', {
  p_user_id: wid,
  p_amount_vnd: -75000,
  p_note: 'Truy thu hồi thẻ đã dùng',
})
check('Đẩy số dư xuống âm (−75.000) thành công', !negErr, negErr?.message)
check('Số dư = −35.000', (await bal(wc, wid)) === -35000, `thực tế: ${await bal(wc, wid)}`)

const { error: negWithdraw } = await wc.rpc('create_withdrawal_request', bank())
check('Ví âm → KHÔNG rút được', !!negWithdraw, 'rút được khi đang nợ — lỗ hổng!')
check(
  'Thông báo nói đúng việc cần làm (bù nợ qua nhiệm vụ)',
  /đang nợ/i.test(negWithdraw?.message ?? '') && /nhiệm vụ/i.test(negWithdraw?.message ?? ''),
  `thực tế: ${negWithdraw?.message}`,
)
check('Thông báo nêu đúng số tiền nợ', /35\.?000/.test(negWithdraw?.message ?? ''), `thực tế: ${negWithdraw?.message}`)

const { error: gameWithdraw } = await wc.rpc(
  'create_withdrawal_request',
  bank({ p_method: 'card', p_amount_vnd: 20000, p_card_brand: 'Viettel' }),
)
check('Ví âm thì nạp thẻ cào cũng bị chặn', !!gameWithdraw, 'lách được qua hình thức khác!')

// ── 4. Bù dần bằng nhiệm vụ ───────────────────────────────────
section('4. Làm nhiệm vụ để bù nợ')

const { data: taskId, error: cErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ bù nợ',
  p_description: 'Làm xong để kiếm bù lại khoản đang nợ nhé bạn ơi',
  p_target_url: `https://www.youtube.com/watch?v=nd${SUFFIX}`,
  p_task_type: 'link',
  p_price_vnd: 20000,
  p_quantity: 2,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Admin tạo nhiệm vụ bù nợ được', !!taskId && !cErr, cErr?.message)

const { data: subId, error: claimErr } = await wc.rpc('claim_task', { p_task_id: taskId })
check('Người nợ nhận nhiệm vụ', !!subId && !claimErr, claimErr?.message)

const r1 = `https://vnsite.test/bu-no/${SUFFIX}-a`
const { error: subErr1 } = await wc.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: r1,
  p_note: '',
  p_evidence_path: null,
})
check('Nộp thành quả lượt 1', !subErr1, subErr1?.message)
const { error: apErr1 } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: subId,
  p_approve: true,
  p_note: '',
})
check('Duyệt lượt 1', !apErr1, apErr1?.message)
check('Số dư = −15.000 (vẫn âm)', (await bal(wc, wid)) === -15000, `thực tế: ${await bal(wc, wid)}`)

const { error: stillBlocked } = await wc.rpc('create_withdrawal_request', bank())
check('Vẫn âm nên vẫn chưa rút được', !!stillBlocked, 'rút được khi vẫn còn nợ!')

// ── 5. Bù về đúng 0 ──────────────────────────────────────────
section('5. Bù về 0')

await execSQL(`
  insert into public.transactions (user_id, amount_vnd, type, note)
  values ('${wid}', 15000, 'task_reward', 'Bù nợ test');
`)
check('Số dư về đúng 0', (await bal(wc, wid)) === 0, `thực tế: ${await bal(wc, wid)}`)

const { error: zeroWithdraw } = await wc.rpc('create_withdrawal_request', bank())
check('Số dư = 0 vẫn chưa rút được (rút cần > 0)', !!zeroWithdraw, zeroWithdraw?.message)

// ── 6. Sang dương là rút được ────────────────────────────────
section('6. Có dư là rút được')

await execSQL(`
  insert into public.transactions (user_id, amount_vnd, type, note)
  values ('${wid}', 45000, 'task_reward', 'Kiếm thêm test');
`)
check('Số dư = 45.000', (await bal(wc, wid)) === 45000, `thực tế: ${await bal(wc, wid)}`)

const { data: wdId, error: okWithdraw } = await wc.rpc('create_withdrawal_request', bank())
check('Số dư dương → rút được', !!wdId && !okWithdraw, okWithdraw?.message)
check('Rút 10.000 → còn 35.000', (await bal(wc, wid)) === 35000, `thực tế: ${await bal(wc, wid)}`)

const { error: overWithdraw } = await wc.rpc('create_withdrawal_request', bank({ p_amount_vnd: 999999 }))
check('Rút vượt số dư → bị chặn', !!overWithdraw)

// ── 7. Sổ cái bất biến ───────────────────────────────────────
section('7. Sổ cái vẫn append-only')

const { error: editTx } = await adminClient
  .from('transactions')
  .update({ amount_vnd: 999999 })
  .eq('user_id', wid)
  .select()
check('Sửa số tiền trong sổ cái → bị chặn', !!editTx)

const { error: delTx } = await adminClient.from('transactions').delete().eq('user_id', wid).select()
check('Xoá dòng sổ cái → bị chặn', !!delTx)

// ═══════════════════════════════════════════════════════════════
console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (failures.length) {
  console.log('\x1b[31mCác mục lỗi:\x1b[0m')
  failures.forEach((f) => console.log(`  · ${f}`))
}
if (process.env.KEEP_TEST_DATA !== '1') {
  await execSQL(`
    delete from public.withdrawal_requests
     where user_id in (select id from public.profiles where email like '%@vnsite.test');
    delete from public.tasks
     where created_by in (select id from public.profiles where email like '%@vnsite.test');
    delete from auth.users where email like '%@vnsite.test';
  `)
  console.log('\nĐã dọn dữ liệu test.')
}
process.exit(fail ? 1 : 0)
