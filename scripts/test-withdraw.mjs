/**
 * TEST RÚT TIỀN — mô hình 3 phương thức
 *   game : nạp thẳng vào game, người rút chỉ cần mệnh giá + ID tài khoản
 *   card : thẻ cào, MÃ DO ADMIN GIAO — người rút không nhập mã
 *   bank : chuyển khoản ngân hàng
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { execSQL } from './db-run.mjs'

const _fetch = globalThis.fetch
globalThis.fetch = async (i, o) => {
  let last
  for (let n = 1; n <= 6; n++) {
    try { return await _fetch(i, o) } catch (e) { last = e; await new Promise((s) => setTimeout(s, 800 * n)) }
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
const PW = 'Ruttien@123456'
const mail = (r) => `wx${r}.${SUF}@vnsite.test`
const card = (t) => `https://vnsite.test/ket-qua/${SUF}-${t}`

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
const mk = async (m, name) => {
  const r = await retry(async () => {
    const c = createClient(S, K, { auth: { persistSession: false } })
    return c.auth.signUp({ email: m, password: PW, options: { data: { full_name: name } } })
  }, `đăng ký ${m}`)
  if (r.error) throw new Error(`đăng ký ${m}: ${r.error.message}`)
  return r.data.user.id
}
const signIn = async (m) => {
  const r = await retry(async () => {
    const c = createClient(S, K, { auth: { persistSession: false } })
    return c.auth.signInWithPassword({ email: m, password: PW })
  }, `đăng nhập ${m}`)
  if (r.error) throw new Error(`đăng nhập ${m}: ${r.error.message}`)
  return r.data.session
}
/**
 * PHẢI kiểm tra lỗi của setSession. Bỏ qua nó thì khi mạng giật ta nhận về
 * một client CHƯA ĐĂNG NHẬP — mọi lệnh admin sẽ hỏng âm thầm và dễ bị
 * tưởng nhầm là lỗi của sản phẩm.
 */
const login = async (m) => {
  for (let a = 1; a <= 6; a++) {
    const sess = await signIn(m)
    const c = createClient(S, K, { auth: { persistSession: false } })
    const { error } = await c.auth.setSession({
      access_token: sess.access_token,
      refresh_token: sess.refresh_token,
    })
    if (!error) {
      const { data: chk } = await c.auth.getUser()
      if (chk?.user) return c
    }
    if (a === 6) throw new Error(`thiết lập phiên cho ${m} thất bại`)
    await new Promise((s) => setTimeout(s, 3000 * a))
  }
}
const rpc = (c, fn, args) => c.rpc(fn, args)
/** lệnh dọn dữ liệu: in lỗi ra thay vì nuốt im lặng */
const cleanup = async (c, fn, args, tag) => {
  const r = await c.rpc(fn, args)
  if (r.error) console.log(`    \x1b[33m[dọn lỗi @${tag}]\x1b[0m ${r.error.message}`)
  return r
}
const bal = async (id) => Number((await sql(`select balance_vnd from public.v_wallet where user_id='${id}'`))?.balance_vnd ?? -1)

console.log(`\n\x1b[1mTEST RÚT TIỀN (3 phương thức)\x1b[0m`)

const admId = await mk(mail('admin'), 'Quản trị')
const u1 = await mk(mail('u1'), 'Người Một')
const u2 = await mk(mail('u2'), 'Người Hai')
await sql(`update public.profiles set role='admin' where id='${admId}';`)
const adm = await login(mail('admin'))

for (const id of [u1, u2]) {
  await rpc(adm, 'admin_adjust_balance', { p_user_id: id, p_amount_vnd: 200000, p_note: 'Nạp tiền thử nghiệm' })
}
const u1R = await login(mail('u1'))
const u2R = await login(mail('u2'))
check('Hai tài khoản được cộng 200.000 ₫', (await bal(u1)) === 200000 && (await bal(u2)) === 200000)

// ══════════════════════════════════════════════════════════════
section('1. Nạp vào game — chỉ cần mệnh giá + ID tài khoản')
for (const g of ['Free Fire', 'Roblox', 'Liên Quân']) {
  const r = await rpc(u1R, 'create_withdrawal_request', {
    p_method: 'game', p_amount_vnd: 20000, p_game_platform: g,
    p_game_account_id: `123456789${g.length}`, p_card_brand: '', p_note: '',
  })
  check(`Tạo yêu cầu nạp ${g} không cần mã thẻ`, !!r.data && !r.error, r.error?.message)
  if (r.data) await cleanup(adm, 'admin_review_withdrawal', { p_id: r.data, p_status: 'rejected', p_note: 'dọn dữ liệu thử' }, g)
}
check('Số dư về 200.000', (await bal(u1)) === 200000, `thực tế: ${await bal(u1)}`)

const noId = await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'game', p_amount_vnd: 20000, p_game_platform: 'Free Fire', p_game_account_id: '1',
})
check('Thiếu ID tài khoản game → bị chặn', !!noId.error, noId.error?.message)

const noGame = await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'game', p_amount_vnd: 20000, p_card_brand: 'Free Fire',
})
check('Không chọn game → bị chặn', !!noGame.error)

// ══════════════════════════════════════════════════════════════
section('2. Trừ tiền ngay khi gửi yêu cầu')
const g1 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'game', p_amount_vnd: 50000, p_game_platform: 'Free Fire', p_game_account_id: '99887766',
})).data
check('Tạo yêu cầu nạp game 50.000', !!g1)
check('Số dư 200.000 → 150.000 ngay lập tức', (await bal(u1)) === 150000, `thực tế: ${await bal(u1)}`)

const rowG = await sql(`select status, method, game_platform, game_account_id from public.withdrawal_requests where id='${g1}'`)
check('Trạng thái pending', rowG?.status === 'pending')
check('Lưu đúng game + ID tài khoản', rowG?.game_platform === 'Free Fire' && rowG?.game_account_id === '99887766')
const rowGC = await sql(`select card_code from public.withdrawal_requests where id='${g1}'`)
check('KHÔNG có mã thẻ nào do người rút nhập', (rowGC?.card_code ?? '') === '', `thực tế: ${rowGC?.card_code}`)

// ══════════════════════════════════════════════════════════════
section('3. Mệnh giá')
// nạp đủ cho mệnh giá lớn nhất (200.000) vì các vòng trước đã rút bớt
await rpc(adm, 'admin_adjust_balance', { p_user_id: u1, p_amount_vnd: 200000, p_note: 'bổ sung cho phép thử' })
const balDenom = await bal(u1)
for (const d of [5000, 10000, 20000, 50000, 100000, 200000]) {
  const r = await rpc(u1R, 'create_withdrawal_request', {
    p_method: 'card', p_amount_vnd: d, p_card_brand: 'Viettel',
  })
  check(`Thẻ cào ${(d / 1000).toLocaleString('vi-VN')}k hợp lệ`, !!r.data && !r.error, r.error?.message)
  if (r.data) await cleanup(adm, 'admin_review_withdrawal', { p_id: r.data, p_status: 'rejected', p_note: 'dọn dữ liệu thử' }, d)
}
check('Số dư về đúng mức ban đầu sau vòng thử', (await bal(u1)) === balDenom, `thực tế: ${await bal(u1)}, kỳ vọng: ${balDenom}`)

for (const d of [3000, 15000, 30000, 150000, 1000000]) {
  const r = await rpc(u1R, 'create_withdrawal_request', {
    p_method: 'card', p_amount_vnd: d, p_card_brand: 'Zing',
  })
  check(`Chặn mệnh giá lạ ${(d / 1000).toLocaleString('vi-VN')}k`, !!r.error, 'lẽ ra phải bị chặn')
}

// ══════════════════════════════════════════════════════════════
section('4. Thẻ cào — mã do admin giao, không ai duyệt vô tình được')
const b4 = await bal(u1)
const c1 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'card', p_amount_vnd: 100000, p_card_brand: 'Vinaphone',
})).data
check('Tạo yêu cầu thẻ cào 100.000 (không cần mã)', !!c1)
check('Số dư trừ đúng 100.000', (await bal(u1)) === b4 - 100000, `thực tế: ${await bal(u1)}, kỳ vọng: ${b4 - 100000}`)

const badApprove = await rpc(adm, 'admin_review_withdrawal', { p_id: c1, p_status: 'approved', p_note: 'x' })
check('KHÔNG duyệt được thẻ cào qua hàm duyệt thường', !!badApprove.error, badApprove.error?.message)

const shortCode = await rpc(adm, 'admin_deliver_card', { p_id: c1, p_code: '123', p_serial: '', p_note: '' })
check('Giao mã thẻ quá ngắn → bị chặn', !!shortCode.error, shortCode.error?.message)

const noCode = await rpc(adm, 'admin_deliver_card', { p_id: c1, p_code: '', p_serial: '', p_note: '' })
check('Giao thẻ không có mã → bị chặn', !!noCode.error)

const CODE = `${SUF}-VINAPHONE-9000-XYZ`
const del = await rpc(adm, 'admin_deliver_card', { p_id: c1, p_code: CODE, p_serial: 'SER123', p_note: 'Đã gửi mã' })
check('Giao thẻ thành công', !del.error, del.error?.message)

const rowC = await sql(`select status, card_code, card_serial from public.withdrawal_requests where id='${c1}'`)
check('Yêu cầu chuyển sang approved', rowC?.status === 'approved', `thực tế: ${rowC?.status}`)
check('Mã thẻ lưu đúng', rowC?.card_code === CODE)
check('Tiền KHÔNG quay lại sau khi giao thẻ', (await bal(u1)) === b4 - 100000, `thực tế: ${await bal(u1)}`)

const delAgain = await rpc(adm, 'admin_deliver_card', { p_id: c1, p_code: 'ABC-123-XYZ', p_serial: '', p_note: '' })
check('Giao thẻ 2 lần → bị chặn', !!delAgain.error)
const rowC2 = await sql(`select card_code from public.withdrawal_requests where id='${c1}'`)
check('Mã thẻ không bị ghi đè', rowC2?.card_code === CODE)

const delWrong = await rpc(adm, 'admin_deliver_card', { p_id: g1, p_code: 'ZZZ-999-YYY', p_serial: '', p_note: '' })
check('Giao mã cho yêu cầu không phải thẻ cào → bị chặn', !!delWrong.error, delWrong.error?.message)

// ══════════════════════════════════════════════════════════════
section('5. Chống rút vượt số dư khi gọi song song')
const u2bal = await bal(u2)
const par = await Promise.all(
  [50_000, 50_000, 50_000, 50_000, 50_000].map((v, i) =>
    rpc(u2R, 'create_withdrawal_request', {
      p_method: 'game', p_amount_vnd: v, p_game_platform: 'Roblox', p_game_account_id: `IDPAR${i}`,
    }),
  ),
)
const okN = par.filter((r) => r.data && !r.error).length
const canTake = Math.floor(u2bal / 50_000)
check(
  `5 request 50.000 cùng lúc trên số dư ${u2bal.toLocaleString('vi-VN')} → đúng ${canTake} thành công`,
  okN === canTake,
  `thành công: ${okN}`,
)
check('Số dư không âm', (await bal(u2)) === 0, `thực tế: ${await bal(u2)}`)

const pend = JSON.parse(await execSQL(`select id from public.withdrawal_requests where user_id='${u2}' and status='pending'`))
for (const r of pend) await rpc(adm, 'admin_review_withdrawal', { p_id: r.id, p_status: 'rejected', p_note: 'dọn dữ liệu thử' })
check('Hoàn tiền đầy đủ', (await bal(u2)) === u2bal, `thực tế: ${await bal(u2)}, kỳ vọng: ${u2bal}`)

// ══════════════════════════════════════════════════════════════
section('6. Từ chối → hoàn tiền đúng một lần')
const b6 = await bal(u1)
await rpc(adm, 'admin_review_withdrawal', { p_id: g1, p_status: 'rejected', p_note: 'Sai ID tài khoản' })
check('Từ chối yêu cầu game → hoàn đúng 50.000', (await bal(u1)) === b6 + 50000, `thực tế: ${await bal(u1)}, kỳ vọng: ${b6 + 50000}`)

const rej2 = await rpc(adm, 'admin_review_withdrawal', { p_id: g1, p_status: 'rejected', p_note: 'lần 2' })
check('Từ chối lần 2 bị chặn', !!rej2.error)
check('Số dư KHÔNG bị hoàn 2 lần', (await bal(u1)) === b6 + 50000, `thực tế: ${await bal(u1)}`)

const noref = await rpc(adm, 'admin_review_withdrawal', { p_id: c1, p_status: 'rejected', p_note: '' })
check('Từ chối thiếu lý do bị chặn', !!noref.error, noref.error?.message)

const c2 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'card', p_amount_vnd: 20000, p_card_brand: 'Garena',
})).data

const bC2 = await bal(u1)
await rpc(adm, 'admin_review_withdrawal', { p_id: c2, p_status: 'rejected', p_note: 'Kho hết thẻ' })
check('Từ chối yêu cầu thẻ cào → hoàn tiền', (await bal(u1)) === bC2 + 20000, `thực tế: ${await bal(u1)}, kỳ vọng: ${bC2 + 20000}`)

// ══════════════════════════════════════════════════════════════
section('7. Nạp game & ngân hàng — duyệt bình thường')
const b7 = await bal(u1)
const g2 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'game', p_amount_vnd: 50000, p_game_platform: 'Liên Quân', p_game_account_id: 'LQA-556677',
})).data
check('Nạp game trừ đúng 50.000', (await bal(u1)) === b7 - 50000, `thực tế: ${await bal(u1)}`)
await rpc(adm, 'admin_review_withdrawal', { p_id: g2, p_status: 'processing', p_note: 'Đang nạp' })
const g2p = await sql(`select status from public.withdrawal_requests where id='${g2}'`)
check('Chuyển "đang xử lý" được', g2p?.status === 'processing')
check('Chuyển xử lý không đổi số dư', (await bal(u1)) === b7 - 50000, `thực tế: ${await bal(u1)}`)
await rpc(adm, 'admin_review_withdrawal', { p_id: g2, p_status: 'approved', p_note: 'Đã nạp vào game' })
const g2a = await sql(`select status from public.withdrawal_requests where id='${g2}'`)
check('Duyệt thành công', g2a?.status === 'approved')
check('Tiền không quay lại sau khi nạp game', (await bal(u1)) === b7 - 50000, `thực tế: ${await bal(u1)}`)

const b7b = await bal(u1)
const b1 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'bank', p_amount_vnd: 30000, p_bank_code: 'Vietcombank',
  p_bank_holder: 'NGUYEN VAN A', p_bank_number: '0123456789',
})).data
check('Rút ngân hàng trừ đúng 30.000', (await bal(u1)) === b7b - 30000, `thực tế: ${await bal(u1)}`)
await rpc(adm, 'admin_review_withdrawal', { p_id: b1, p_status: 'approved', p_note: 'Đã chuyển khoản' })
check('Chuyển khoản xong, tiền không quay lại', (await bal(u1)) === b7b - 30000, `thực tế: ${await bal(u1)}`)

// ══════════════════════════════════════════════════════════════
section('8. Quyền hạn')
const selfRev = await rpc(u1R, 'admin_review_withdrawal', { p_id: b1, p_status: 'approved', p_note: 'tự' })
check('Worker không gọi được hàm admin', !!selfRev.error || !selfRev.data)

const otherW = (await rpc(u2R, 'create_withdrawal_request', {
  p_method: 'card', p_amount_vnd: 20000, p_card_brand: 'Zing',
})).data
const seen = await u1R.from('v_withdrawals').select('id').eq('id', otherW)
const seenRows = Array.isArray(seen.data) ? seen.data : []
check('Worker không thấy yêu cầu của người khác', seenRows.length === 0, `thấy ${seenRows.length}`)
const upd = await u2R.from('withdrawal_requests').update({ status: 'approved' }).eq('id', otherW)
check('Worker không sửa được trạng thái trực tiếp', (Array.isArray(upd.data) ? upd.data : []).length === 0)
const own = await u2R.from('v_withdrawals').select('id')
check('Worker thấy được yêu cầu của chính mình', (Array.isArray(own.data) ? own.data : []).some((x) => x.id === otherW))

await rpc(adm, 'admin_adjust_balance', { p_user_id: admId, p_amount_vnd: 50000, p_note: 'nạp cho admin' })
const selfW = (await rpc(adm, 'create_withdrawal_request', {
  p_method: 'card', p_amount_vnd: 20000, p_card_brand: 'Zing',
})).data
const selfDup = await rpc(adm, 'admin_deliver_card', { p_id: selfW, p_code: 'SELF-123-ABC', p_serial: '', p_note: '' })
check('Admin không tự giao thẻ cho yêu cầu của chính mình', !!selfDup.error, selfDup.error?.message)

// ══════════════════════════════════════════════════════════════
section('9. Huỷ của người dùng')
const before = await bal(u1)
const w3 = (await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'game', p_amount_vnd: 20000, p_game_platform: 'Roblox', p_game_account_id: 'CANCEL01',
})).data
check('Trừ tiền ngay', (await bal(u1)) === before - 20000)
const { error: cErr } = await rpc(u1R, 'cancel_withdrawal', { p_id: w3 })
check('Huỷ thành công', !cErr, cErr?.message)
check('Hoàn tiền đủ', (await bal(u1)) === before, `thực tế: ${await bal(u1)}`)
const cross = await rpc(u2R, 'cancel_withdrawal', { p_id: w3 })
check('Không huỷ được yêu cầu của người khác', !!cross.error)

section('10. Ràng buộc ngân hàng')
const small = await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'bank', p_amount_vnd: 5000, p_bank_code: 'MB', p_bank_holder: 'A', p_bank_number: '0123456789',
})
check('Rút ngân hàng dưới 10.000 → bị chặn', !!small.error)
const badAcct = await rpc(u1R, 'create_withdrawal_request', {
  p_method: 'bank', p_amount_vnd: 20000, p_bank_code: 'MB', p_bank_holder: 'A', p_bank_number: '123',
})
check('Số tài khoản quá ngắn → bị chặn', !!badAcct.error)
const badMethod = await rpc(u1R, 'create_withdrawal_request', { p_method: 'crypto', p_amount_vnd: 20000 })
check('Phương thức lạ → bị chặn', !!badMethod.error)
const noBrand = await rpc(u1R, 'create_withdrawal_request', { p_method: 'card', p_amount_vnd: 20000 })
check('Thẻ cào thiếu thương hiệu → bị chặn', !!noBrand.error)

await execSQL(`delete from public.withdrawal_requests where user_id in ('${u1}','${u2}','${admId}');`)
await execSQL(`delete from auth.users where email like 'wx%.${SUF}@vnsite.test';`)

console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (bad.length) { console.log('\x1b[31mMục lỗi:\x1b[0m'); bad.forEach((b) => console.log(`  · ${b}`)) }
process.exit(fail ? 1 : 0)
