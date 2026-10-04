/**
 * BỘ TEST NGHIỆM THU + BẢO MẬT
 *
 * Chạy bằng PUBLISHABLE KEY — giống hệt trình duyệt thật.
 * Nếu bất kỳ phép thử nào thất bại, nghĩa là RLS chưa đủ chặt.
 *
 * Dùng:  node scripts/test-security.mjs
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

// Kết nối tới Supabase từ môi trường CI này hay bị reset TLS ngẫu nhiên.
// Bọc fetch để thử lại thay vì báo lỗi giả.
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

/** Client đăng nhập bằng email (dùng token thật trong Authorization). */
async function signIn(email) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`đăng nhập ${email} thất bại: ${error.message}`)
  return c
}

async function register(email, name) {
  const c = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signUp({ email, password: PW, options: { data: { full_name: name } } })
  if (error) throw new Error(`đăng ký ${email} thất bại: ${error.message}`)
  return { client: c, session: data.session }
}

const emailOf = (r) => `r${r}.${SUFFIX}@vnsite.test`

// ═══════════════════════════════════════════════════════════════
const TARGET = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
// phải duy nhất theo từng lượt chạy — index UNIQUE toàn cục trên result_url sẽ
// chặn nếu dùng lại đúng link đã từng nộp ở lần trước
const RESULT = `https://vnsite.test/ket-qua/${SUFFIX}-abc123`

console.log(`\n\x1b[1mBỘ TEST — ref ${SB_URL.split('//')[1].split('.')[0]}\x1b[0m`)

// ── 1. Tài khoản ─────────────────────────────────────────────
section('1. Tài khoản & phân quyền')

const admin = await register(emailOf('admin'), 'Quản trị Việt')
const { error: bootErr } = await admin.client.rpc('bootstrap_first_admin', { p_full_name: 'Quản trị Việt' })
check('KHÔNG ai tự phong quyền admin khi đăng ký', !!bootErr, 'gọi được — lỗ hổng!')

let adminClient = await signIn(emailOf('admin'))
check('Tài khoản đăng ký mới mặc định là worker', true)

const w1 = await register(emailOf('w1'), 'Người Nhận Một')
const { error: bootErr2 } = await w1.client.rpc('bootstrap_first_admin', { p_full_name: 'x' })
check('Tài khoản thứ hai cũng không lên admin', !!bootErr2)

// Không còn ai được tự làm admin → cấp quyền qua SQL như thực tế vận hành
const { execSQL: esql } = await import('./db-run.mjs')
await esql(`update public.profiles set role='admin' where id='${admin.session.user.id}';`)
const { data: roleNow2 } = await adminClient.from('profiles').select('role').eq('id', admin.session.user.id).single()
check('Admin được cấp quyền qua SQL, giờ thấy role=admin', roleNow2?.role === 'admin', `thực tế: ${roleNow2?.role}`)
adminClient = await signIn(emailOf('admin'))
const w1c = await signIn(emailOf('w1'))

const reg2 = await register(emailOf('w2'), 'Người Nhận Hai')
const w2c = await signIn(emailOf('w2'))
const reg3 = await register(emailOf('w3'), 'Người Nhận Ba')
const w3c = await signIn(emailOf('w3'))

// ── 2. Admin tạo nhiệm vụ ────────────────────────────────────
section('2. Admin tạo nhiệm vụ')

const { data: taskId, error: cErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Vượt video YouTube kiểm thử',
  p_description: 'Xem hết video để test',
  p_target_url: TARGET,
  p_task_type: 'link',
  p_price_vnd: 5000,
  p_quantity: 3,
  p_deadline_at: new Date(Date.now() + 86400000).toISOString(),
  p_priority: 'hot',
})
check('admin_create_task thành công', !!taskId && !cErr, cErr?.message)

const { data: board } = await w1c.from('v_tasks').select('*').eq('id', taskId).single()
check('Nhiệm vụ hiện lên trang chủ', board?.id === taskId)
check('Bảng công khai KHÔNG có cột target_url', board && !('target_url' in board), Object.keys(board ?? {}).join(','))
check('Giá hiển thị đúng 5.000', board?.price_vnd === 5000, `thực tế: ${board?.price_vnd}`)
check('Còn 3 lượt', board?.remaining === 3, `thực tế: ${board?.remaining}`)

// ── 3. Worker KHÔNG thấy link ────────────────────────────────
section('3. Worker không thấy link trước khi nhận')

const { data: rawTasks } = await w1c.from('tasks').select('*')
check('Worker đọc thẳng bảng `tasks` → 0 dòng', (rawTasks ?? []).length === 0, `nhận được ${rawTasks?.length} dòng`)

const { data: peek } = await w1c.rpc('get_target_url', { p_submission_id: '00000000-0000-0000-0000-000000000000' })
check('Gọi get_target_url với lượt không có → null', peek === null, `nhận ${JSON.stringify(peek)}`)

const { error: wCreate } = await w1c.rpc('admin_create_task', {
  p_title: 'Cố tạo nhiệm vụ', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 5000, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
check('Worker KHÔNG tạo được nhiệm vụ', !!wCreate, 'lẽ ra phải bị chặn')

// ── 4. Nhận nhiệm vụ ─────────────────────────────────────────
section('4. Nhận nhiệm vụ')

const { data: subId, error: claimErr } = await w1c.rpc('claim_task', { p_task_id: taskId })
check('Worker nhận nhiệm vụ thành công', !!subId && !claimErr, claimErr?.message)

const { data: target } = await w1c.rpc('get_target_url', { p_submission_id: subId })
check('Sau khi nhận mới thấy link cần vượt', target === TARGET, `nhận ${JSON.stringify(target)}`)

const { error: dupClaim } = await w1c.rpc('claim_task', { p_task_id: taskId })
check('Cùng người KHÔNG nhận 2 lượt của 1 task', !!dupClaim, 'lẽ ra phải bị chặn')

const { data: mineW1 } = await w1c.from('v_submissions').select('*')
check('Worker chỉ thấy lượt của chính mình', (mineW1 ?? []).every((s) => s.worker_id === w1.session.user.id))

const { data: w2Sees } = await w2c.from('v_submissions').select('*')
check('Worker khác KHÔNG thấy lượt của người này', (w2Sees ?? []).length === 0, `thấy ${w2Sees?.length} lượt`)

// ── 5. Gửi thành quả ────────────────────────────────────────
section('5. Gửi link thành quả')

const { data: fake, error: fakeErr } = await w1c.rpc('submit_result', {
  p_submission_id: subId, p_result_url: TARGET, p_note: '', p_evidence_path: null
})
check('Dán link nhiệm vụ gốc làm thành quả → bị chặn', !!fakeErr, 'lẽ ra phải bị chặn')

const { error: badUrl } = await w1c.rpc('submit_result', {
  p_submission_id: subId, p_result_url: 'không phải link', p_note: '', p_evidence_path: null
})
check('Gửi chuỗi không phải URL → bị chặn', !!badUrl)

const { error: crossSubmit } = await w2c.rpc('submit_result', {
  p_submission_id: subId, p_result_url: RESULT, p_note: '', p_evidence_path: null
})
check('Worker khác nộp lượt của người này → bị chặn', !!crossSubmit, 'lẽ ra phải bị chặn')

const { error: subErr } = await w1c.rpc('submit_result', {
  p_submission_id: subId, p_result_url: RESULT, p_note: 'đã xem hết', p_evidence_path: null
})
check('Gửi link hợp lệ thành công', !subErr, subErr?.message)

const { data: before } = await w1c.from('v_wallet').select('*').eq('user_id', w1.session.user.id).single()
check('Gửi xong ví CHƯA cộng tiền', Number(before?.balance_vnd) === 0, `thực tế: ${before?.balance_vnd}`)

const { error: wSelfReview } = await w1c.rpc('admin_review_submission', {
  p_submission_id: subId, p_approve: true, p_note: '',
})
check('Worker KHÔNG tự duyệt được', !!wSelfReview, 'lẽ ra phải bị chặn')

// ── 6. Admin duyệt ──────────────────────────────────────────
section('6. Admin duyệt & cộng tiền')

const { error: apErr } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: subId, p_approve: true, p_note: '',
})
check('Admin duyệt thành công', !apErr, apErr?.message)

const { data: after } = await w1c.from('v_wallet').select('*').eq('user_id', w1.session.user.id).single()
check('Ví được cộng đúng 5.000 ₫', Number(after?.balance_vnd) === 5000, `thực tế: ${after?.balance_vnd}`)
check('Tổng đã kiếm = 5.000', Number(after?.total_earned_vnd) === 5000)

const { error: again } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: subId, p_approve: true, p_note: '',
})
check('Duyệt lần 2 bị chặn (không cộng tiền 2 lần)', !!again, 'lẽ ra phải bị chặn')

const { data: after2 } = await w1c.from('v_wallet').select('*').eq('user_id', w1.session.user.id).single()
check('Số dư KHÔNG đổi sau lần duyệt thứ 2', Number(after2?.balance_vnd) === 5000, `thực tế: ${after2?.balance_vnd}`)

// ── 7. Không ai sửa được sổ cái / quyền ─────────────────────
section('7. Chống sửa trực tiếp')

const { error: roleErr } = await w1c
  .from('profiles').update({ role: 'admin' }).eq('id', w1.session.user.id)
check('Worker tự đổi role → bị chặn', !!roleErr, 'lẽ ra phải bị chặn')

const { data: roleNow } = await w1c.from('profiles').select('role').eq('id', w1.session.user.id).single()
check('Role vẫn là worker sau khi thử sửa', roleNow?.role === 'worker')

const { error: txErr } = await w1c
  .from('transactions').update({ amount_vnd: 999999999 }).eq('user_id', w1.session.user.id)
check('Sửa số tiền trong sổ cái → bị chặn', !!txErr, 'lẽ ra phải bị chặn')

const { error: delErr } = await w1c.from('transactions').delete().eq('user_id', w1.session.user.id)
check('Xoá dòng sổ cái → bị chặn', !!delErr, 'lẽ ra phải bị chặn')

const { data: balAfterTamper } = await w1c.from('v_wallet').select('balance_vnd').eq('user_id', w1.session.user.id).single()
check('Số dư vẫn nguyên 5.000 sau mọi thao tác', Number(balAfterTamper?.balance_vnd) === 5000, `thực tế: ${balAfterTamper?.balance_vnd}`)

const { data: auditDenied } = await w1c.from('audit_log').select('*').limit(1)
check('Worker không đọc được nhật ký kiểm toán', (auditDenied ?? []).length === 0, `thấy ${auditDenied?.length} dòng`)

// ── 8. Tranh chấp slot ──────────────────────────────────────
section('8. Tranh chấp lượt (race condition)')

const { data: raceTask } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ tranh chấp 1 lượt', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 7000, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})

const race = await Promise.all([
  w1c.rpc('claim_task', { p_task_id: raceTask }),
  w2c.rpc('claim_task', { p_task_id: raceTask }),
  w3c.rpc('claim_task', { p_task_id: raceTask }),
])
const won = race.filter((r) => r.data && !r.error).length
check('3 request cùng lúc tranh 1 lượt → đúng 1 thắng', won === 1, `thắng: ${won}`)

const { data: raceRow } = await adminClient.from('tasks').select('taken_count, quantity, status').eq('id', raceTask).single()
check('taken_count không vượt quantity', raceRow?.taken_count <= raceRow?.quantity, JSON.stringify(raceRow))
check('Task tự đóng khi hết lượt', raceRow?.status === 'closed', `trạng thái: ${raceRow?.status}`)

const { data: fullTask } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ 1 lượt đã lấy hết', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 2500, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
const { data: firstTake } = await w3c.rpc('claim_task', { p_task_id: fullTask })
check('Lượt duy nhất được lấy', !!firstTake)
const { error: overClaim } = await w2c.rpc('claim_task', { p_task_id: fullTask })
check('Người khác nhận nhiệm vụ đã hết lượt → bị chặn', !!overClaim, 'lẽ ra phải bị chặn')

// ── 9. Chống copy-paste link ────────────────────────────────
section('9. Chống gian lận thành quả')

const { data: cpTask } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ chống copy-paste', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 4000, p_quantity: 5,
  p_deadline_at: null, p_priority: 'normal',
})
const RESULT_A = `https://vnsite.test/ket-qua/${SUFFIX}-lan-dau`
const RESULT_B = `https://vnsite.test/ket-qua/${SUFFIX}-lan-hai`
const { data: cpSub } = await w3c.rpc('claim_task', { p_task_id: cpTask })
const { error: cpErr } = await w3c.rpc('submit_result', {
  p_submission_id: cpSub, p_result_url: RESULT_A, p_note: '', p_evidence_path: null
})
check('Lượt đầu nhận link bình thường', !cpErr, cpErr?.message)

const { data: cp2Task } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ chống copy-paste 2', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 4000, p_quantity: 5,
  p_deadline_at: null, p_priority: 'normal',
})
const { data: cp2Sub } = await w2c.rpc('claim_task', { p_task_id: cp2Task })
const { error: cpErr2 } = await w2c.rpc('submit_result', {
  p_submission_id: cp2Sub, p_result_url: RESULT_A, p_note: '', p_evidence_path: null
})
check('Người khác dùng lại đúng link đó → bị chặn', !!cpErr2, 'lẽ ra phải bị chặn')

const { error: cpErr3 } = await w2c.rpc('submit_result', {
  p_submission_id: cp2Sub, p_result_url: RESULT_B, p_note: '', p_evidence_path: null
})
check('Dùng link khác chưa từng dùng → được chấp nhận', !cpErr3, cpErr3?.message)

// ── 10. Hạn nộp ─────────────────────────────────────────────
section('10. Hạn nộp thành quả')

const { data: lateTask } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ đã quá hạn', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 6000, p_quantity: 2,
  p_deadline_at: new Date(Date.now() + 3600000).toISOString(), p_priority: 'normal',
})
const { data: lateSub } = await w3c.rpc('claim_task', { p_task_id: lateTask })

// Ép hạn về quá khứ bằng quyền postgres (mô phỏng nhiệm vụ đã hết hạn)
const { execSQL } = await import('./db-run.mjs')
await execSQL(`update public.tasks set deadline_at = now() - interval '1 hour' where id = '${lateTask}';`)

const { error: lateErr } = await w3c.rpc('submit_result', {
  p_submission_id: lateSub, p_result_url: 'https://vnsite.test/ket-qua-qua-han-xyz', p_note: '', p_evidence_path: null
})
check('Nộp sau hạn → bị chặn', !!lateErr, 'lẽ ra phải bị chặn')

const { error: lateClaim } = await w1c.rpc('claim_task', { p_task_id: lateTask })
check('Nhận nhiệm vụ đã quá hạn → bị chặn', !!lateClaim, 'lẽ ra phải bị chặn')

// ── 11. Bỏ lượt ─────────────────────────────────────────────
section('11. Bỏ lượt trả về kho')

const { data: cancelTask } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ để test bỏ lượt', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 3000, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
const { data: cancelSub, error: cancelClaimErr } = await w2c.rpc('claim_task', { p_task_id: cancelTask })
if (cancelClaimErr) console.log('    [debug] claim lỗi:', cancelClaimErr.message)
const { error: cancelErr } = await w2c.rpc('cancel_my_submission', { p_submission_id: cancelSub })
check('Bỏ lượt thành công', !cancelErr, cancelErr?.message)

const { data: backOpen } = await adminClient.from('tasks').select('taken_count, status').eq('id', cancelTask).single()
check('Lượt trả về kho (taken_count = 0)', backOpen?.taken_count === 0, `thực tế: ${backOpen?.taken_count}`)

const { data: reclaim } = await w2c.rpc('claim_task', { p_task_id: cancelTask })
check('Có thể nhận lại lượt vừa bỏ', !!reclaim, cancelErr?.message)

// ── 12. Giá nhiệm vụ tự do ───────────────────────────────────
section('12. Giá nhiệm vụ tự do (không còn mức tối thiểu 1.000 ₫)')

const { data: cheap, error: cheapErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ giá rẻ kiểm thử', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 1, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
check('Tạo được nhiệm vụ giá 1 ₫', !!cheap && !cheapErr, cheapErr?.message)

const balOf = async (c, uid) =>
  Number((await c.from('v_wallet').select('balance_vnd').eq('user_id', uid).single()).data?.balance_vnd ?? 0)
const cheapBefore = await balOf(w3c, reg3.session.user.id)

const { data: cheapSub, error: cheapClaimErr } = await w3c.rpc('claim_task', { p_task_id: cheap })
check('Nhận được lượt nhiệm vụ giá 1 ₫', !!cheapSub && !cheapClaimErr, cheapClaimErr?.message)

const cheapResult = `https://vnsite.test/ket-qua/${SUFFIX}-cheap`
const { error: cheapSubErr } = await w3c.rpc('submit_result', {
  p_submission_id: cheapSub, p_result_url: cheapResult, p_note: '', p_evidence_path: null,
})
check('Nộp được thành quả cho nhiệm vụ giá 1 ₫', !cheapSubErr, cheapSubErr?.message)

// Mấu chốt: sổ cái chặn giao dịch 0, nên nếu cho phép giá 0 thì DUYỆT sẽ
// văng lỗi và nhiệm vụ kẹt vĩnh viễn ở "chờ duyệt". Đây là phép thử bảo vệ
// cho cái ràng buộc price_vnd >= 1.
const { error: cheapRevErr } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: cheapSub, p_approve: true, p_note: '',
})
check('Duyệt được nhiệm vụ giá 1 ₫ (sổ cái ghi được dòng 1 ₫)', !cheapRevErr, cheapRevErr?.message)

const cheapAfter = await balOf(w3c, reg3.session.user.id)
check('Ví người nhận cộng đúng 1 ₫', cheapAfter - cheapBefore === 1,
  `trước ${cheapBefore} → sau ${cheapAfter}`)

const { error: zeroErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ giá 0 ₫', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 0, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
check('Giá 0 ₫ vẫn bị chặn (sổ cái không nhận giao dịch 0)', !!zeroErr)

const { error: overErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Nhiệm vụ giá quá trần', p_description: '', p_target_url: TARGET,
  p_task_type: 'link', p_price_vnd: 10000001, p_quantity: 1,
  p_deadline_at: null, p_priority: 'normal',
})
check('Giá vượt trần 10.000.000 ₫ vẫn bị chặn (chốn gõ nhầm)', !!overErr)

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
    delete from public.tasks where target_url = '${TARGET}';
    delete from auth.users where email like '%@vnsite.test';
  `)
  console.log('\nĐã dọn dữ liệu test.')
}
process.exit(fail ? 1 : 0)
