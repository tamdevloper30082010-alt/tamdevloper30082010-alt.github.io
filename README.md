# Vượt Nhanh — sàn nhiệm vụ vượt liên kết

Sàn giao dịch nhiệm vụ: admin đăng nhiệm vụ kèm mức thưởng VND → nhiệm vụ hiện lên
trang chủ → người nhận bấm "Nhận nhiệm vụ" thì mới thấy link cần vượt, kèm ô input
để gửi link thành quả → admin duyệt thì tiền mới cộng vào ví.

## Triển khai

Đang chạy trên **GitHub Pages**: <https://tamdevloper30082010-alt.github.io>

Mỗi lần `git push` lên `main`, workflow `.github/workflows/deploy.yml` tự build
và phát hành. Cấu hình nằm ở *Settings → Secrets and variables → Actions →
Variables* (không nằm trong code).

Cài lại từ đầu: xoá `.github`, chạy `npm create vite@latest _s -- --template react-ts`,
chép lại `src/`, `supabase/`, `scripts/`, `public/`, rồi đặt lại hai biến ở trên.

### Đường dẫn sâu (deep link)

GitHub Pages phục vụ file tĩnh, nên mở thẳng `/cong-viec` sẽ không có file đó. Hai
file xử lý chuyện này:

- `public/404.html` — nhớ đường dẫn vào `sessionStorage` rồi quay về `/`
- `src/main.tsx` — đọc lại và `history.replaceState` trước khi React render

Nhờ vậy F5 hay mở link sâu đều giữ nguyên đường dẫn.

### Gắn domain riêng

Repo này là **user site** (`<tên>.github.io`) nên nó phục vụ ở gốc — thuận tiện
nhất cho việc gắn domain:

1. Trỏ CNAME của domain về `tamdevloper30082010-alt.github.io`
2. Trong repo: tạo file `CNAME` ở thư mục gốc chứa domain của bạn, ví dụ `vn.example.com`
3. Bật **Enforce HTTPS** trong *Settings → Pages* (mặc định đã bật)

Cần thêm thì cấu hình DNS ở nhà cung cấp domain (A record về IP GitHub Pages hoặc
CNAME), GitHub sẽ tự cấp chứng chỉ Let's Encrypt trong khoảng 15–30 phút.

## Chạy

```bash
npm install
npm run dev
```

Cần `.env` (xem `.env.example`):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

> Chỉ dùng **publishable** key. Secret key (`sb_secret_…` / `service_role`) tuyệt đối
> không đưa vào frontend — mọi thao tác đặc quyền đã nằm trong RLS + RPC.

## Cấp quyền quản trị

**Không còn luật "người đăng ký đầu tiên là admin".** Luật đó là lỗ hổng trên trang
public: chỉ cần ai đăng ký trước chủ sở hữu là nắm toàn quyền. Hàm
`bootstrap_first_admin` vẫn còn trong database nhưng **đã thu hồi quyền gọi** cho mọi
tài khoản đã đăng nhập — không ai tự phong được.

Cấp quyền admin bằng cách sửa email trong file rồi chạy:

```bash
# scripts/make-admin.sql
export SUPABASE_REF=<project-ref>
export SUPABASE_ACCESS_TOKEN=sbp_...
./scripts/db.sh scripts/make-admin.sql
```

Lệnh này nâng role của đúng một tài khoản và ghi vào nhật ký kiểm toán. Từ đó, admin
có thể cấp/thu quyền cho người khác ngay trong trang quản trị.

## Rút tiền

Ba phương thức, người nhận chọn ở tab **Rút tiền**:

| Phương thức | Người rút cần làm | Admin làm |
|---|---|---|
| **🎮 Nạp vào game** | chọn mệnh giá + nhập **ID tài khoản game** | nạp thẳng vào tài khoản đó |
| **🎟 Thẻ cào** | chọn thương hiệu + mệnh giá | dán mã thẻ vào, hệ thống gửi cho người rút |
| **🏦 Ngân hàng** | tên ngân hàng, chủ TK, số TK (tối thiểu 10.000) | chuyển khoản ra ngoài |

Game: Free Fire, Roblox, Liên Quân. Thẻ cào: Viettel, Vinaphone, Zing, Garena.
Mệnh giá: 5k / 10k / 20k / 50k / 100k / 200k (database chặt bằng `CHECK`).

> Người rút **không bao giờ phải nhập mã thẻ**. Mã thẻ là thứ admin giao lại.
> Bản đầu tiên của tính năng này bắt người rút tự nhập "mã thẻ" — sai ngược
> luồng: rút tiền là người rút *nhận* thẻ, không phải mang thẻ tới nộp.

**Tiền bị trừ ngay khi gửi yêu cầu**, ghi thẳng vào sổ cái trong cùng giao dịch.
Admin từ chối thì hoàn lại. Cách này chặn được kiểu "gửi 10 yêu cầu cùng lúc
rồi duyệt từng cái" — với mỗi yêu cầu đã trừ tiền ngay từ đầu.

Trạng thái: `Đang chờ` → `Đang xử lý` → `Đã hoàn thành`, hoặc `Bị từ chối` /
`Đã huỷ` (cả hai đều hoàn tiền). Người nhận tự huỷ được yêu cầu đang chờ.

Chống gian lận ở tầng database:

- Rút vượt số dư bị chặn kể cả khi gọi song song — hàm khoá dòng profile
  trước khi đọc số dư nên các yêu cầu xếp hàng thay vì chạy đua nhau.
- Mệnh giá ngoài danh sách bị `CHECK` từ chối.
- **Không thể đánh dấu hoàn thành một yêu cầu thẻ cào khi chưa có mã** — bắt
  buộc phải đi qua hàm giao thẻ, không lách được bằng hàm duyệt thường.
- Từ chối hai lần chỉ hoàn tiền một lần.
- Admin không tự duyệt yêu cầu rút của chính mình.
- Worker không đọc được yêu cầu của người khác, không sửa được trạng thái.

## Ẩn và xoá nhiệm vụ

Ba mức, tách rõ để không mất dấu vết tiền:

| Hành động | Khi nào dùng | Dữ liệu |
|---|---|---|
| **Đóng / Mở lại** | tạm ngừng nhận, giữ trên trang quản trị | giữ nguyên |
| **Ẩn** | gỡ khỏi bảng tin (nhiệm vụ đã đủ người nhận) | **giữ nguyên**, chỉ đánh dấu `archived_at` |
| **Xoá hẳn** | nhiệm vụ **chưa ai nhận** | xoá thật |

Vì sao nhiệm vụ đã có người nhận không xoá hẳn được: sổ cái ghi "thưởng nhiệm vụ"
chứ không ghi tên nhiệm vụ — xoá đi thì mất manh mối "ai được trả tiền vì cái gì".
Nút **Ẩn** giải quyết đúng nhu cầu (gỡ khỏi danh sách) mà vẫn giữ được dấu vết.

Bảng tin chỉ trả về nhiệm vụ còn nhận được, lọc ở **view trong database**
(`v_tasks`), không lọc ở JavaScript — cùng nguyên tắc với phần tiền. Nhiệm vụ
đã đóng nằm ở `v_tasks_closed`, chỉ tải khi người dùng bật "Xem cả nhiệm vụ đã đóng".

## Cấu trúc

```
supabase/schema.sql      toàn bộ DB: bảng, RLS, RPC, view, audit log
scripts/db.sh            chạy SQL lên Supabase qua Management API (PAT từ env)
scripts/test-security.mjs  bộ test nghiệm thu + bảo mật
scripts/make-admin.sql     cấp quyền admin cho một tài khoản cụ thể
scripts/verify-admin.mjs  kiểm tra không ai tự phong quyền được
scripts/test-withdraw.mjs bộ test riêng cho rút tiền (64 phép)
scripts/test-archive.mjs  bộ test ẩn/xoá nhiệm vụ (20 phép)
scripts/reset-test-data.sql dọn dữ liệu test
src/lib/money.ts         tiền — chỉ số nguyên, VND không có phần thập phân
src/lib/supabase.ts      client + cách rút thông điệp lỗi tiếng Việt từ DB
```

## Bảo đảm tài chính

| Nguyên tắc | Cách thực hiện |
|---|---|
| Số dư không thể lệch | Số dư là **view** tính từ sổ cái, không phải cột lưu |
| Sổ cái bất biến | `REVOKE UPDATE, DELETE` — sai thì tạo dòng điều chỉnh, không sửa/xoá dòng cũ |
| Không cộng tiền 2 lần | `FOR UPDATE` + chặn transition nếu không phải trạng thái `submitted` |
| Không vượt quá số lượt | `FOR UPDATE` trên task + kiểm tra số lượt **bên trong** lock |
| Không tự lên admin | Không còn đường tự phong quyền; cấp quyền qua `scripts/make-admin.sql` |
| Không tự duyệt task mình | `admin_review_submission` chặn `worker_id = auth.uid()` |
| Không thấy link trước khi nhận | Worker đọc `tasks` được 0 dòng; link qua RPC `get_target_url` |
| Frontend bị sửa vẫn vô hại | Không có secret key trong web; RLS từ chối mọi thao tác đặc quyền |

Chống gian lận: chặn dán link nhiệm vụ gốc làm thành quả · `UNIQUE` toàn cục trên
`result_url` nên một link chỉ được dùng một lần · chặn nhận 2 lượt của cùng 1 task ·
chặn nhận nhiệm vụ do mình tạo · giới hạn 10 lượt đang giữ (có nút "Bỏ lượt" để trả về
kho) · chặn nộp quá hạn.

## Triển khai

Đang chạy trên **GitHub Pages**: <https://tamdevloper30082010-alt.github.io>

Mỗi lần `git push` lên `main`, workflow `.github/workflows/deploy.yml` tự build
và phát hành. Cấu hình nằm ở *Settings → Secrets and variables → Actions →
Variables* (không nằm trong code).

Cài lại từ đầu: xoá `.github`, chạy `npm create vite@latest _s -- --template react-ts`,
chép lại `src/`, `supabase/`, `scripts/`, `public/`, rồi đặt lại hai biến ở trên.

### Đường dẫn sâu (deep link)

GitHub Pages phục vụ file tĩnh, nên mở thẳng `/cong-viec` sẽ không có file đó. Hai
file xử lý chuyện này:

- `public/404.html` — nhớ đường dẫn vào `sessionStorage` rồi quay về `/`
- `src/main.tsx` — đọc lại và `history.replaceState` trước khi React render

Nhờ vậy F5 hay mở link sâu đều giữ nguyên đường dẫn.

### Gắn domain riêng

Repo này là **user site** (`<tên>.github.io`) nên nó phục vụ ở gốc — thuận tiện
nhất cho việc gắn domain:

1. Trỏ CNAME của domain về `tamdevloper30082010-alt.github.io`
2. Trong repo: tạo file `CNAME` ở thư mục gốc chứa domain của bạn, ví dụ `vn.example.com`
3. Bật **Enforce HTTPS** trong *Settings → Pages* (mặc định đã bật)

Cần thêm thì cấu hình DNS ở nhà cung cấp domain (A record về IP GitHub Pages hoặc
CNAME), GitHub sẽ tự cấp chứng chỉ Let's Encrypt trong khoảng 15–30 phút.

## Chạy bộ test

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...   # PAT, cần quyền Database: Read-write
export SUPABASE_REF=<project-ref>
node scripts/test-security.mjs
```

47 phép thử, chạy bằng publishable key — đúng như trình duyệt thật. Tự dọn dữ liệu test
khi xong; đặt `KEEP_TEST_DATA=1` để giữ lại.

Bộ test rút tiền chạy riêng:

```bash
node scripts/test-withdraw.mjs     # 64 phép
node scripts/verify-admin.mjs      # 7 phép
node scripts/test-archive.mjs      # 20 phép
```

> Lưu ý vận hành: `withdrawal_requests.reviewed_by` tham chiếu `profiles` không
> `ON DELETE`, nên **xoá tài khoản từng duyệt tiền sẽ bị database từ chối**. Đây là
> chủ ý — dấu vết người duyệt không được phép mất. Muốn xoá thì xoá yêu cầu rút
> tiền của họ trước.

## Theme

Hai theme được thiết kế riêng (không phải lật màu), toàn bộ màu nằm trong biến CSS ở
`src/index.css`. Script nhỏ trong `index.html` gắn theme trước khi React render nên
không nháy trắng. Lần đầu vào sẽ theo `prefers-color-scheme` của hệ điều hành.
