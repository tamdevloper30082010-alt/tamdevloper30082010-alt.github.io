# Kế hoạch: Sàn nhiệm vụ "Vượt Liên Kết" (Task Board + Admin Panel)

> v2 — 03/10/2026 · Đã chốt: server-side cho toàn bộ nghiệp vụ tiền, chuyển theme linh hoạt, admin responsive.
> Trạng thái: chờ nhận PAT Supabase để thiết lập.

---

## 1. Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Stack | Vite + React 19 + TS + Tailwind v4 + Supabase |
| Nghiệp vụ tiền | **100% xử lý ở Postgres.** Client chỉ gọi RPC, không tự tính tiền |
| Theme | Dark / Light chuyển động, lưu lựa chọn, cả 2 theme đều được thiết kế riêng |
| Admin panel | Responsive thật — dùng được trên điện thoại lẫn máy tính |
| Hạ tầng | 1 project Supabase bạn đã có, tôi tự thiết lập qua PAT |

---

## 2. Kiến trúc bảo mật tài chính — phần quan trọng nhất

### 2.1 Nguyên tắc

Frontend là **public artifact**. Tôi sẽ deploy nó lên URL công khai, bất kỳ ai cũng tải được, đọc source, thêm script, gọi thẳng API. Vì vậy:

> **Mọi thứ liên quan đến tiền chỉ được tin khi Postgres nói vậy. JavaScript không bao giờ được tin.**

Cụ thể, `service_role_key` **không bao giờ** xuất hiện trong frontend. Mọi thao tác đặc quyền đi qua RLS + function `SECURITY DEFINER` tự kiểm tra `auth.uid()`. Hệ quả: dù ai đó sửa toàn bộ code frontend, database vẫn từ chối. Đây là thuộc tính kiến trúc, không phải biện phòng thủ.

### 2.2 Sơ đồ luồng tiền

```
WORKER                     BROWSER                    POSTGRES
  │  bấm "Nhận nhiệm vụ" ──────▶ rpc('claim_task', {task_id})
  │                                │                   ┌─ khóa task FOR UPDATE
  │                                │                   ├─ check open & còn slot
  │                                │                   ├─ check không trùng / không tự nhận task mình
  │                                │                   ├─ chụp snapshot price_vnd
  │                                │                   ├─ +1 taken_count, tự đóng khi đủ
  │                                │                   └─ INSERT submission
  │  gửi link thành quả ─────────▶ rpc('submit_result', {id, result_url})
  │                                │                   ├─ chủ sở hữu submission?
  │                                │                   ├─ còn trong hạn?
  │                                │ ├─ chặn result_url == target_url
  │                                │                   └─ status = 'submitted'
  │
  │                            ADMIN bấm DUYỆT ─────▶ rpc('review_submission', {id, true})
  │                                │                   ├─ khóa submission FOR UPDATE
  │                                │                   ├─ caller là admin? (không phải chính mình)
  │                                │                   ├─ status phải = 'submitted'
  │                                │                   └─ INSERT transactions (+price)
  │
  │                            gọi view v_wallet ◀──── balance = TỔNG ledger
```

### 2.3 Số dư là **view**, không phải cột

Điểm mấu chốt. Thay vì lưu `profiles.balance_vnd` rồi cộng/trừ, số dư được **tính từ sổ cái**:

```sql
CREATE VIEW v_wallet AS
SELECT user_id,
       COALESCE(SUM(amount_vnd), 0)                      AS balance_vnd,
       COALESCE(SUM(amount_vnd) FILTER (WHERE amount_vnd > 0), 0) AS total_earned_vnd,
       COALESCE(-SUM(amount_vnd) FILTER (WHERE amount_vnd < 0), 0) AS total_paid_vnd,
       MAX(created_at)                                    AS last_activity_at
FROM transactions GROUP BY user_id;
```

Vì sao mạnh hơn: số dư **không thể lệch**. Không có dữ liệu nào để "lệch" — nó là hàm của ledger. Xoá code cộng tiền đi thì vẫn đúng. Đây là thứ tôi muốn nhất ở mặt tài chính.

### 2.4 Sổ cái bất biến

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON transactions FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON profiles     FROM anon, authenticated;
```

Không ai sửa hay xoá lịch sử giao dịch — kể cả admin. Sai rồi thì tạo dòng điều chỉnh ngược, đúng cách kế toán. Không có UPDATE/DELETE thì không cần lo ai đó quay tay bỏ dấu vết.

### 2.5 Danh sách chống gian lận

| Tấn công | Phòng thủ | Ở đâu |
|---|---|---|
| Bấm "Nhận" 2 lượt cùng lúc, vượt quá số slot | `SELECT ... FOR UPDATE` trên task + kiểm tra `taken_count < quantity` **bên trong** lock | RPC |
| Admin bấm Duyệt 2 lần → cộng tiền 2 lần | `FOR UPDATE` trên submission + chặn transition nếu không phải `submitted` | RPC |
| Tự đổi role mình thành admin | `profiles` không được UPDATE trực tiếp; chỉ qua `admin_set_role()` kiểm tra caller | RPC + RLS |
| Người nhận duyệt task của chính mình | `review_submission` chặn `worker_id = auth.uid()` | RPC |
| Sửa/xoá số dư bằng cách gọi API trực tiếp | Số dư là view, không có cột để sửa; ledger bất biến | Schema |
| Claim vô tận rồi bỏ (chiếm sân) | Tối đa **10** submission `in_progress` đồng thời; submission quá 24h không gửi sẽ bị admin thu hồi slot | RPC |
| Người nhận nhận nhiệm vụ do chính mình tạo | RPC chặn `tasks.created_by = auth.uid()` | RPC |
| Tăng giá sau khi worker đã nhận | `price_vnd` chụp snapshot trong lúc claim, từ giá trị server đọc | RPC |
| Gửi luôn `target_url` làm "link thành quả" | CHECK: `result_url <> target_url`, chỉ nhận scheme `http/https` | RPC + Schema |
| Copy 1 link thành quả cho 10 lượt | UNIQUE `(task_id, result_url)` | Schema |
| Nhận 2 lượt cùng 1 task | UNIQUE `(task_id, worker_id)` khi đang `in_progress` | Schema |
| Lộ link cần vượt trước khi nhận | Worker chỉ đọc được `target_url` khi có submission `in_progress` của chính họ | RLS |
| Đăng ký hàng loạt tài khoản ảo | Bắt buộc xác nhận email + giới hạn tần suất đăng ký | Auth |
| Người nhận "tháo" slot rồi admin duyệt nhầm | Admin thấy rõ task/slot trước khi duyệt; có nút thu hồi slot | Quy trình |
| Người tấn công sửa bản deploy của tôi | Không có `service_role_key` ở frontend — RLS từ chối mọi thao tác đặc quyền | Kiến trúc |
| Lộ bí mật trong bundle | `.env` chỉ chứa URL + anon key; PAT nằm trong secret store, không bao giờ vào repo | Quy trình |

### 2.6 Nhật ký kiểm toán

Bảng `audit_log` — append-only, chỉ admin đọc được. Ghi lại: ai, lúc nào, hành động gì, dữ liệu trước/sau.

```
claim_task · submit_result · review_submission(approve/reject)
· admin_set_role · admin_adjust_balance · admin_release_slot
```

Mỗi dòng tiền trong hệ thống đều truy ngược được về một dòng audit tương ứng.

### 2.7 Củng cố function

Mọi function `SECURITY DEFINER` đều:
- `SET search_path = public, pg_temp` — chặn tấn công search_path hijacking
- `REVOKE EXECUTE ... FROM public, anon` — chỉ `authenticated` mới gọi được
- Kiểm tra `auth.uid()` và role ngay trong thân function

### 2.8 Kích hoạt admin đầu tiên

Không ai tự phong mình được. Đúng một người đăng ký đầu tiên nhận role admin, an toàn kể cả khi 2 người đăng ký cùng lúc:

```sql
CREATE FUNCTION bootstrap_first_admin(full_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bootstrap_admin_v1'));
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Hệ thống đã có admin.';
  END IF;
  UPDATE profiles SET full_name = full_name, role = 'admin' WHERE id = auth.uid();
END $$;
```

`pg_advisory_xact_lock` đảm bảo đúng một giao dịch thắng, các giao dịch còn lại thua và nhận thông báo lỗi.

---

## 3. Ràng buộc nghiệp vụ

- Tiền luôn là **số nguyên** (`bigint`). VND không có phần thập phân — tuyệt đối không `float`. Hiển thị `Intl.NumberFormat('vi-VN')` → `5.000 ₫`.
- Giá tối thiểu 1.000 ₫, tối đa 10.000.000 ₫/lượt.
- Chỉ 1 người nhận được mỗi lượt; hết slot → task tự `closed`.
- Link cần vượt chỉ hiện **sau** khi nhận nhiệm vụ.
- Admin từ chối thì **bắt buộc** có lý do — không có từ chối trống lý do.
- Không có đường tắt nào cộng tiền ngoài `review_submission(approve)`.

---

## 4. Schema

```
profiles            id uuid pk (= auth.users.id) · email · full_name
                    role 'admin'|'worker' · created_at
                    ⚠ không có cột tiền — số dư nằm ở v_wallet

tasks               id · title · description · target_url ⚠(RLS)
                    platform 'youtube'|'tiktok'|'facebook'|'website'|'seo'|'khac'
                    price_vnd bigint · quantity int · taken_count int
                    status 'open'|'closed' · priority 'normal'|'hot'
                    deadline_at · created_by · created_at
                    CHECK (taken_count >= 0 AND taken_count <= quantity)

submissions         id · task_id · worker_id · result_url · note
                    price_vnd bigint        ← snapshot lúc claim
                    status 'in_progress'|'submitted'|'approved'|'rejected'
                    admin_note · created_at · submitted_at · reviewed_at · reviewed_by
                    UNIQUE (task_id, result_url)
                    UNIQUE partial (task_id, worker_id) WHERE status='in_progress'

transactions        id · user_id · amount_vnd bigint
                    type 'task_reward'|'payout'|'adjustment'
                    ref_id · note · created_at
                    ⚠ REVOKE UPDATE/DELETE

audit_log           id · actor_id · action · entity · entity_id
                    payload jsonb · created_at
                    ⚠ REVOKE UPDATE/DELETE

v_wallet            VIEW (mục 2.3)
```

---

## 5. Hệ thống theme

**Token màu, không hard-code.** Toàn bộ màu nằm trong biến CSS, ánh xạ vào utility Tailwind — đổi theme là đổi giá trị biến, không phải sửa component.

```css
:root, [data-theme="dark"] {
  --bg: 7 7 12;  --surface: 255 255 255 / .04;
  --fg: 244 244 255;  --muted: 148 155 180;
  --accent: 16 185 129;  --money: 251 191 36;
  --danger: 244 63 94;   --info: 56 189 248;
  --glow: .45;           /* cường độ shadow màu */
}
[data-theme="light"] {
  --bg: 247 248 252; --surface: 255 255 255 / .72;
  --fg: 16 18 32;    --muted: 92 100 124;
  --accent: 5 150 105; --money: 217 119 6;
  --danger: 225 29 72;  --info: 2 132 199;
  --glow: .12;
}
@theme inline {
  --color-bg: rgb(var(--bg));
  --color-fg: rgb(var(--fg));
  /* … */
}
```

- Toggle trên header, lưu `localStorage`, đọc `prefers-color-scheme` làm mặc định lần đầu
- Script nhỏ nạp **trước** React để gắn `data-theme` — không được nháy trắng khi load
- Hai theme được **thiết kế riêng**, không phải lật màu: light dùng shadow màu nhạt thay cho glow, aurora nhạt hơn, tương phản chữ kiểm lại

---

## 6. Admin responsive

| Mốc | Bố cục |
|---|---|
| ≥ 1024px | Sidebar cố định + bảng dữ liệu đầy đủ |
| 768–1023px | Sidebar thu gọn thành icon |
| < 768px | Sidebar thành drawer trượt; **bảng đổi thành card list** (bảng ở 375px là không dùng được); thanh hành động Duyệt/Từ chối dính đáy màn hình, nút cao ≥ 44px để bấm bằng ngón tay |

Bottom nav 4 mục cho admin trên điện thoại: Dashboard · Nhiệm vụ · Duyệt · Người dùng.

---

## 7. Phạm vi

**v1:** auth + 2 role · trang chủ có filter/sort/tìm · nhận nhiệm vụ · màn "Nhiệm vụ của tôi" (link + ô input) · admin CRUD nhiệm vụ đặt giá VND · hàng đợi duyệt · ví + sổ cái · audit log.

**Ngoài v1:** rút tiền qua ngân hàng/MoMo (v1 cộng vào ví, admin chuyển khoản tay rồi tick) · nạp tiền online · phạt bỏ ngang · đánh giá uy tín · thông báo push.

---

## 8. Bàn giao Supabase

**Cần từ bạn 2 thứ:**
1. **Project ref** — chuỗi 20 ký tự trong `https://<ref>.supabase.co`
2. **Personal Access Token** (`sbp_…`)

PAT dùng làm gì: liệt kê project, đọc cấu hình, lấy anon key, chạy file SQL schema (RLS + RPC + view) thông qua Management API.

**Cách tôi xử lý an toàn:**
- Lưu PAT vào kho secret mã hóa của phiên làm việc, **không** ghi ra file, **không** đưa vào repo
- Dùng trong shell để setup rồi xong việc
- **Bạn nên rotate PAT sau khi tôi setup xong** — token đó đã đi qua môi trường của tôi
- `.env` chỉ chứa `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Anon key là public theo thiết kế; `service_role_key` **không dùng và không cần** vì mọi thao tác đặc quyền đã nằm trong RLS/RPC

**Cấu hình Auth tôi sẽ đặt:** bắt buộc xác nhận email (chặn đăng ký ảo hàng loạt — đây là đường gian lận lớn nhất), rồi tôi dựng màn hình xác thực email. Muốn bỏ thì tắt 1 công tắc.

---

## 9. Tiêu chí nghiệm thu

**Nghiệp vụ:**
1. Admin tạo task 5.000 ₫/lượt × 3 lượt → hiện ngay trang chủ, worker **không** thấy `target_url`
2. Worker nhận → mở màn hiện **link cần vượt + ô input bên dưới**
3. Gửi link → "Chờ duyệt", ví **chưa** đổi
4. Admin Duyệt → ví **+5.000 ₫**, ledger ghi dòng `task_reward`
5. Admin Từ chối → worker thấy lý do, sửa và gửi lại được
6. Đủ 3 lượt → task `closed`, không ai nhận thêm

**Bảo mật — test bằng cách gọi thẳng REST API, không qua UI:**
7. Worker tự `PATCH profiles` đổi `role='admin'` → **bị từ chối**
8. Worker gọi `claim_task` 10 lần liên tiếp trên task 3 lượt → lần 4+ **bị từ chối**
9. 2 request `claim_task` song song cùng 1 slot → đúng **1** thành công
10. Gọi `review_submission(approve)` 2 lần → tiền cộng **đúng 1 lần**
11. Worker tự `review_submission` task của mình → **bị từ chối**
12. `UPDATE transactions SET amount_vnd = 999999` → **bị từ chối** (không có quyền)
13. Gửi `result_url` = `target_url` → **bị từ chối**
14. Worker đọc `target_url` task chưa nhận qua REST → **không thấy**
15. Gửi kết quả sau `deadline_at` → **bị từ chối**
16. Tạo 10.000 tài khoản tự động → bị chặn bởi xác nhận email + rate limit

**Giao diện:**
17. Chuyển theme đổi ngay, load lại trang vẫn giữ, không nháy trắng
18. Admin dùng được ở 375px: drawer, card list, nút bấm đủ to
19. Worker dùng ở 375px: nút "Nhận nhiệm vụ" full-width, không trượt ngang

---

## 10. Thứ tự thực hiện

1. Dựng Vite + React + TS + Tailwind, theme token, component nền
2. `money.ts` + provider interface + mock → demo end-to-end ngay
3. Trang chủ · chi tiết task · luồng nhận
4. Màn "Nhiệm vụ của tôi" (link + ô input) + bộ lọc trạng thái
5. Admin panel (desktop → mobile)
6. **Schema SQL: bảng + RLS + 5 RPC + view + audit log + trigger**
7. Nạp schema lên Supabase bằng PAT, bật RLS, đặt cấu hình auth
8. Chuyển provider sang Supabase, chạy 16 test nghiệm thu
9. Polish chuyển động · build · deploy
