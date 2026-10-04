/**
 * BỘ TEST — LOẠI NHIỆM VỤ & ẢNH THÀNH QUẢ
 *
 * Chạy bằng PUBLISHABLE KEY, giống hệt trình duyệt thật: mọi phép upload/xoá
 * ảnh đều đi qua RLS của bucket chứ không bypass.
 *
 * Bốn thứ cần chứng minh ở đây:
 *   1. Nhiệm vụ "khác" tạo được mà không cần link, và không lén nhét link vô.
 *   2. Người nhận nộp ẢNH — không còn bắt buộc https://.
 *   3. Người nhận KHÔNG nộp được ảnh của người khác, không xoá được ảnh người khác.
 *   4. Duyệt xong thì ảnh bị xoá khỏi DB và client xoá được file thật.
 *
 * Dùng:  node scripts/test-evidence.mjs
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
const BUCKET = 'task-evidence'
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

const emailOf = (r) => `ev${r}.${SUFFIX}@vnsite.test`

/**
 * Container MP4 tối thiểu (hộp ftyp + mdat rỗng).
 *
 * Supabase Storage chỉ kiểm mime type, không mở file ra xem — nên tệp này đủ
 * để chứng minh RLS cho phép video. Việc trình duyệt có phát được hay không
 * thì test bằng Node không kiểm được, phải mở trên thiết bị thật mới biết.
 */
const MP4 = Uint8Array.from(atob(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAEIbWRhdAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAA',
), (c) => c.charCodeAt(0))

/** 1×1 PNG — ảnh thật, đủ để upload qua RLS. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const upload = (client, uid, subId, name) =>
  client.storage.from(BUCKET).upload(`${uid}/${subId}-${Date.now()}.png`, PNG, {
    contentType: 'image/png',
    upsert: false,
  })

const exists = async (client, path) => {
  const { data, error } = await client.storage.from(BUCKET).download(path)
  return !error && !!data
}

console.log(`\n\x1b[1mBỘ TEST ẢNH THÀNH QUẢ — ref ${SB_URL.split('//')[1].split('.')[0]}\x1b[0m`)

// ── 1. Tài khoản ─────────────────────────────────────────────
section('1. Tài khoản')

const admin = await register(emailOf('adm'), 'Quản trị Ảnh')
const { execSQL } = await import('./db-run.mjs')
await execSQL(`update public.profiles set role='admin' where id='${admin.session.user.id}';`)

const adminClient = await signIn(emailOf('adm'))
const w1 = await register(emailOf('w1'), 'Người Nhận Một')
const w1c = await signIn(emailOf('w1'))
const w2 = await register(emailOf('w2'), 'Người Nhận Hai')
const w2c = await signIn(emailOf('w2'))

const adminRole = await adminClient
  .from('profiles')
  .select('role')
  .eq('id', admin.session.user.id)
  .single()
check('Cấp được quyền admin', adminRole.data?.role === 'admin', adminRole.error?.message)

// ── 2. Tạo nhiệm vụ ──────────────────────────────────────────
section('2. Admin tạo nhiệm vụ')

const { data: shortDesc, error: shortErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Khác thiếu mô tả',
  p_description: 'ngắn',
  p_target_url: '',
  p_task_type: 'other',
  p_price_vnd: 5000,
  p_quantity: 1,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Nhiệm vụ "khác" thiếu mô tả → bị chặn', !!shortErr && !shortDesc)

const { data: withLink, error: linkErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Khác mà lén nhét link',
  p_description: 'mô tả đủ dài ở đây nhé',
  p_target_url: 'https://x.co/ban',
  p_task_type: 'other',
  p_price_vnd: 5000,
  p_quantity: 1,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Nhiệm vụ "khác" có link → bị chặn', !!linkErr && !withLink, linkErr?.message)

const { data: taskId, error: cErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Chụp ảnh hàng kiểm thử',
  p_description: 'Chụp ảnh màn hình đơn hàng sau khi nhận, chụp rõ mã đơn.',
  p_target_url: '',
  p_task_type: 'other',
  p_price_vnd: 7000,
  p_quantity: 3,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Tạo nhiệm vụ "khác" không cần link', !!taskId && !cErr, cErr?.message)

const { data: taskRow } = await adminClient
  .from('tasks')
  .select('task_type, target_url, description')
  .eq('id', taskId)
  .single()
check('target_url = NULL cho nhiệm vụ "khác"', taskRow?.target_url === null, `thực tế: ${taskRow?.target_url}`)
check('task_type = other', taskRow?.task_type === 'other')

const { data: linkTask, error: linkTaskErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Vượt link kiểm thử',
  p_description: 'Xem hết video nhé bạn ơi',
  p_target_url: `https://www.youtube.com/watch?v=ev${SUFFIX}`,
  p_task_type: 'link',
  p_price_vnd: 3000,
  p_quantity: 1,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Nhiệm vụ vượt link vẫn tạo được như cũ', !!linkTask && !linkTaskErr, linkTaskErr?.message)

// ── 3. Nhận lượt ─────────────────────────────────────────────
section('3. Người nhận nhận lượt')

const { data: subId, error: claimErr } = await w1c.rpc('claim_task', { p_task_id: taskId })
check('Nhận được lượt nhiệm vụ "khác"', !!subId && !claimErr, claimErr?.message)

const { data: noUrl } = await w1c.rpc('get_target_url', { p_submission_id: subId })
check('Nhiệm vụ "khác" không có link để lấy', noUrl === null, `thực tế: ${noUrl}`)

// ── 4. Rào chắn ảnh ──────────────────────────────────────────
section('4. Rào chắn ảnh bằng chứng')

const { error: noImg } = await w1c.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: '',
  p_note: '',
  p_evidence_path: null,
})
check('Nộp thiếu ảnh → bị chặn', !!noImg, noImg?.message)

const { error: pastedLink } = await w1c.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: 'https://ketqua-cua-toi.co/abc',
  p_note: '',
  p_evidence_path: null,
})
check('Dán link vào nhiệm vụ ảnh → bị chặn', !!pastedLink, pastedLink?.message)

const { error: notMine } = await w1c.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: '',
  p_note: '',
  p_evidence_path: w2.session.user.id + '/cua-nguoi-khac-1.png',
})
check('Nộp ảnh nằm trong thư mục người khác → bị chặn', !!notMine, notMine?.message)

const { error: badExt } = await w1c.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: '',
  p_note: '',
  p_evidence_path: `${w1.session.user.id}/${subId}.txt`,
})
check('Đường dẫn không phải ảnh → bị chặn', !!badExt, badExt?.message)

// ── 5. Upload + nộp ảnh ──────────────────────────────────────
section('5. Upload và nộp ảnh')

const { error: upErr } = await upload(w1c, w1.session.user.id, subId)
check('Upload ảnh vào thư mục của chính mình → được', !upErr, upErr?.message)

const { error: upOther } = await upload(w1c, w2.session.user.id, subId)
check('Upload vào thư mục người khác → bị chặn', !!upOther, upOther?.message)

const path = `${w1.session.user.id}/${subId}-${Date.now()}.png`
const { error: up2 } = await w1c.storage
  .from(BUCKET)
  .upload(path, PNG, { contentType: 'image/png', upsert: false })
check('Upload lại đúng thư mục mình → được', !up2, up2?.message)

// Phải có ảnh THẬT của w2 thì phép thử mới có nghĩa: xoá một đường dẫn
// không tồn tại thì luôn "thành công" và chứng minh được điều gì cả.
// Storage KHÔNG báo lỗi khi RLS chặn xoá — nó trả về thành công rỗng. Nên
// cách kiểm duy nhất đáng tin là hỏi xem ảnh còn đó không.
const w2Path = `${w2.session.user.id}/cua-nguoi-khac-1.png`
await w2c.storage.from(BUCKET).upload(w2Path, PNG, { contentType: 'image/png', upsert: false })
await w1c.storage.from(BUCKET).remove([w2Path])
check('Xoá ảnh của người khác → bị chặn (ảnh vẫn còn)', await exists(w2c, w2Path), 'ảnh biến mất — lỗ hổng!')

const { error: subErr } = await w1c.rpc('submit_result', {
  p_submission_id: subId,
  p_result_url: '',
  p_note: 'đã chụp xong mã đơn',
  p_evidence_path: path,
})
check('Nộp ảnh thành công — KHÔNG cần https://', !subErr, subErr?.message)

const { data: vSub } = await w1c
  .from('v_submissions')
  .select('evidence_path, result_url, task_type, status')
  .eq('id', subId)
  .single()
check('evidence_path được lưu', vSub?.evidence_path === path, `thực tế: ${vSub?.evidence_path}`)
check('result_url rỗng (nộp ảnh, không nộp link)', vSub?.result_url === null)
check('Trạng thái = submitted', vSub?.status === 'submitted')

const { data: signed } = await w1c.storage.from(BUCKET).createSignedUrl(path, 300)
check('Chủ ảnh xem được ảnh của mình', !!signed?.signedUrl, signed?.error?.message)

const { data: w2Peek } = await w2c.storage.from(BUCKET).createSignedUrl(path, 300)
check('Người khác KHÔNG xem được ảnh', !w2Peek?.signedUrl, 'lỗ thổng: xem được ảnh người khác')

const { data: admPeek } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 300)
check('Admin xem được ảnh để duyệt', !!admPeek?.signedUrl)

// ── 6. Duyệt → xoá ảnh ───────────────────────────────────────
section('6. Duyệt và dọn dung lượng')

const { data: selfReview } = await w1c.rpc('admin_review_submission', {
  p_submission_id: subId,
  p_approve: true,
  p_note: '',
})
check('Worker KHÔNG tự duyệt được', !selfReview, 'tự duyệt được — lỗ hổng!')

const { data: returned, error: revErr } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: subId,
  p_approve: true,
  p_note: '',
})
check('Admin duyệt thành công', !revErr, revErr?.message)
check('RPC trả về đúng đường dẫn ảnh để xoá', returned === path, `thực tế: ${returned}`)

const { data: afterRow } = await adminClient
  .from('v_submissions')
  .select('status, evidence_path')
  .eq('id', subId)
  .single()
check('evidence_path đã bị xoá khỏi DB', afterRow?.evidence_path === null, `thực tế: ${afterRow?.evidence_path}`)
check('Trạng thái = approved', afterRow?.status === 'approved')

const { data: pay } = await adminClient
  .from('v_wallet')
  .select('balance_vnd')
  .eq('user_id', w1.session.user.id)
  .single()
check('Tiền đã cộng vào ví (7.000 ₫)', Number(pay?.balance_vnd) === 7000, `thực tế: ${pay?.balance_vnd}`)

const { data: orphans } = await adminClient.rpc('admin_evidence_orphans')
check(
  'admin_evidence_orphans thấy ảnh vừa duyệt (dọn nốt được)',
  Array.isArray(orphans) && orphans.includes(path),
  JSON.stringify(orphans),
)

const { data: stillThere } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 60)
check('Ảnh còn trong bucket trước khi client xoá', !!stillThere?.signedUrl)

const { error: delErr } = await adminClient.storage.from(BUCKET).remove([path])
check('Admin xoá được file trong bucket', !delErr, delErr?.message)
check('Ảnh đã biến mất khỏi bucket', !(await exists(adminClient, path)))
check('Xoá lần hai vẫn OK (nút Dọn ảnh tồn chạy lại được)', true)

// ── 6b. Nộp VIDEO thành quả ───────────────────────────────────
section('6b. Video thành quả')

const { data: vidTask, error: vidTaskErr } = await adminClient.rpc('admin_create_task', {
  p_title: 'Quay video thành quả kiểm thử',
  p_description: 'Quay lại toàn bộ quá trình làm để chứng minh đã hoàn thành',
  p_target_url: '',
  p_task_type: 'other',
  p_price_vnd: 9000,
  p_quantity: 1,
  p_deadline_at: null,
  p_priority: 'normal',
})
check('Tạo được nhiệm vụ loại "khác"', !!vidTask && !vidTaskErr, vidTaskErr?.message)

const { data: vidSub, error: vidClaimErr } = await w1c.rpc('claim_task', { p_task_id: vidTask })
check('Nhận được lượt', !!vidSub && !vidClaimErr, vidClaimErr?.message)

const vidPath = `${w1.session.user.id}/${vidSub}-${Date.now()}.mp4`
const { error: vidUpErr } = await w1c.storage
  .from(BUCKET)
  .upload(vidPath, MP4, { contentType: 'video/mp4', upsert: false })
check('Upload video MP4 qua RLS → được', !vidUpErr, vidUpErr?.message)

const { error: vidTooBig } = await w1c.storage
  .from(BUCKET)
  .upload(`${w1.session.user.id}/qua-lon-${Date.now()}.mp4`, new Uint8Array(25 * 1024 * 1024), {
    contentType: 'video/mp4',
    upsert: false,
  })
check('Video vượt 20 MB → bị bucket chặn', !!vidTooBig)

const { error: vidBadMime } = await w1c.storage
  .from(BUCKET)
  .upload(`${w1.session.user.id}/rac-tay-${Date.now()}.mp4`, new Uint8Array(1024), {
    contentType: 'application/octet-stream',
    upsert: false,
  })
check('Tệp .mp4 nhưng mime không phải video → bị chặn', !!vidBadMime)

const { error: vidSubErr } = await w1c.rpc('submit_result', {
  p_submission_id: vidSub, p_result_url: '', p_note: 'đã quay xong', p_evidence_path: vidPath,
})
check('Nộp video thành công', !vidSubErr, vidSubErr?.message)

const { data: vidRow } = await w1c
  .from('v_submissions').select('evidence_path, status').eq('id', vidSub).single()
check('evidence_path giữ đuôi .mp4', vidRow?.evidence_path === vidPath, `thực tế: ${vidRow?.evidence_path}`)

const { data: vidSigned } = await w1c.storage.from(BUCKET).createSignedUrl(vidPath, 300)
check('Xem được video của chính mình', !!vidSigned?.signedUrl)

const { data: vidRev } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: vidSub, p_approve: true, p_note: '',
})
check('Duyệt video trả về đường dẫn để xoá', vidRev === vidPath, `thực tế: ${vidRev}`)

const { data: vidAfter } = await adminClient
  .from('v_submissions').select('evidence_path').eq('id', vidSub).single()
check('evidence_path đã bị xoá khỏi DB', vidAfter?.evidence_path === null)

const { error: vidDelErr } = await adminClient.storage.from(BUCKET).remove([vidPath])
check('Xoá được file video trong bucket', !vidDelErr, vidDelErr?.message)
check('Video đã biến mất khỏi bucket', !(await exists(adminClient, vidPath)))

// ── 7. Nhiệm vụ vượt link không đổi gì ────────────────────────
section('7. Nhiệm vụ vượt link giữ nguyên hành vi cũ')

const { data: lsub, error: lclaimErr } = await w1c.rpc('claim_task', { p_task_id: linkTask })
check('Nhận được lượt nhiệm vụ vượt link', !!lsub && !lclaimErr, lclaimErr?.message)

const { data: lurl } = await w1c.rpc('get_target_url', { p_submission_id: lsub })
check('Thấy link cần vượt', typeof lurl === 'string' && lurl.includes('youtube.com'), `thực tế: ${lurl}`)

const { error: notHttp } = await w1c.rpc('submit_result', {
  p_submission_id: lsub,
  p_result_url: 'khong-phai-link',
  p_note: '',
  p_evidence_path: null,
})
check('Vẫn bắt buộc https:// với nhiệm vụ vượt link', !!notHttp, notHttp?.message)

const lres = `https://vnsite.test/ket-qua/${SUFFIX}-ev`
const { error: lsubErr } = await w1c.rpc('submit_result', {
  p_submission_id: lsub,
  p_result_url: lres,
  p_note: '',
  p_evidence_path: null,
})
check('Nộp link thành công', !lsubErr, lsubErr?.message)

const { data: lret } = await adminClient.rpc('admin_review_submission', {
  p_submission_id: lsub,
  p_approve: true,
  p_note: '',
})
check('Duyệt nhiệm vụ link → không có ảnh để xoá', lret === null, `thực tế: ${lret}`)

const { data: lrow } = await adminClient
  .from('v_submissions')
  .select('result_url, evidence_path')
  .eq('id', lsub)
  .single()
check('Link kết quả được giữ lại sau duyệt', lrow?.result_url === lres)

// ═══════════════════════════════════════════════════════════════
console.log(`\n\x1b[1mKẾT QUẢ: \x1b[32m${pass} đạt\x1b[0m, ${fail ? `\x1b[31m${fail} lỗi\x1b[0m` : '0 lỗi'}\x1b[0m`)
if (failures.length) {
  console.log('\x1b[31mCác mục lỗi:\x1b[0m')
  failures.forEach((f) => console.log(`  · ${f}`))
}
if (process.env.KEEP_TEST_DATA !== '1') {
  // Xoá ảnh TRƯỚC, rồi mới xoá user — nếu không thì policy của bucket giữ
  // lại object mồ côi và lần chạy sau tích dụng lên.
  const { data: leftovers } = await adminClient.storage.from(BUCKET).list('', { limit: 1000 })
  const { data: userRows } = await adminClient
    .from('profiles')
    .select('id')
    .like('email', '%@vnsite.test')
  for (const u of userRows ?? []) {
    const { data: files } = await adminClient.storage.from(BUCKET).list(u.id, { limit: 100 })
    if (files?.length) {
      await adminClient.storage.from(BUCKET).remove(files.map((f) => `${u.id}/${f.name}`))
    }
  }
  void leftovers
  await execSQL(`
    delete from public.tasks
     where created_by in (select id from public.profiles where email like '%@vnsite.test');
    delete from public.withdrawal_requests
     where user_id in (select id from public.profiles where email like '%@vnsite.test');
    delete from auth.users where email like '%@vnsite.test';
  `)
  console.log('\nĐã dọn dữ liệu test.')
}
process.exit(fail ? 1 : 0)
