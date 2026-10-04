-- ============================================================================
--  SÀN NHIỆM VỤ "VƯỢT LIÊN KẾT" — SCHEMA
--  Toàn bộ nghiệp vụ tiền nằm trong file này. Frontend KHÔNG BAO GIỜ được tin.
--
--  Nguyên tắc thiết kế:
--   1. Số dư là VIEW trên sổ cái, KHÔNG phải cột lưu → không thể lệch.
--   2. Mọi ghi vào DB đi qua SECURITY DEFINER function tự kiểm tra auth.uid().
--   3. transactions + audit_log bất biến (REVOKE UPDATE/DELETE).
--   4. tasks KHÔNG cấp SELECT cho worker → target_url không lọt ra ngoài.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. BẢNG
-- Mỗi CREATE TABLE dùng "if not exists" kèm ĐỦ định nghĩa.
-- TUYỆT ĐỐI không tạo bảng rỗng ở trên để "chạy lại cho an toàn" — làm vậy
-- khiến lần tạo sau bị bỏ qua do bảng đã tồn tại, còn thiếu hết cột.
-- ────────────────────────────────────────────────────────────────────────────

-- KHÔNG có cột tiền ở đây. Số dư = tổng transactions (mục 5).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text        not null default '',
  full_name  text        not null default '',
  role       text        not null default 'worker' check (role in ('admin','worker')),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null check (char_length(trim(title)) between 3 and 120),
  description text        not null default '',
  -- Loại nhiệm vụ quyết định thành quả phải nộp bằng gì:
  --   link  → vượt link, nộp link kết quả
  --   other → làm theo mô tả, nộp ẢNH chứng minh
  task_type   text        not null default 'link'
              check (task_type in ('link','other')),
  -- NULL với nhiệm vụ loại "other" — nhiệm vụ đó không có link nào để vượt.
  target_url  text        check (target_url is null or char_length(trim(target_url)) between 8 and 2000),
  -- Cột cũ, không còn ai đọc. Giữ lại để không mất dữ liệu và quay lui được.
  platform    text        not null default 'khac',
  -- VND không có phần thập phân → bigint, tuyệt đối không dùng float
  -- Tối thiểu là 1, KHÔNG phải 0: sổ cái chặn giao dịch 0, nên nhiệm vụ 0 ₫
  -- sẽ không duyệt được (xem src/lib/money.ts). Trần giữ làm chốn gõ nhầm.
  price_vnd   bigint      not null check (price_vnd >= 1 and price_vnd <= 10000000),
  quantity    int         not null check (quantity between 1 and 10000),
  taken_count int         not null default 0,
  status      text        not null default 'open' check (status in ('open','closed')),
  priority    text        not null default 'normal' check (priority in ('normal','hot')),
  deadline_at timestamptz,
  created_by  uuid        not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  constraint tasks_taken_lte_quantity check (taken_count <= quantity and taken_count >= 0),

  -- Loại "link" thì bắt buộc có link http(s); loại "other" thì không được có link.
  constraint tasks_type_target_check check (
    (task_type = 'link'  and target_url ~* '^https?://')
    or
    (task_type = 'other' and target_url is null)
  ),

  -- Nhiệm vụ "other" bắt buộc có mô tả — nếu không thì người nhận không biết
  -- phải làm gì, còn admin thì không có gì để đối chiếu với ảnh.
  constraint tasks_type_desc_check check (
    task_type <> 'other' or char_length(trim(description)) >= 10
  )
);

-- 1 lượt = 1 dòng. Giá được CHỤP LẢI lúc nhận, không đọc giá hiện tại lúc duyệt.
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  worker_id    uuid not null references public.profiles(id) on delete cascade,
  -- Một trong hai: nhiệm vụ link dùng result_url, nhiệm vụ khác dùng ảnh.
  result_url   text,
  evidence_path text,
  note         text        not null default '',
  price_vnd    bigint      not null,
  status       text        not null default 'in_progress'
               check (status in ('in_progress','submitted','approved','rejected','cancelled')),
  admin_note   text,
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id),

  -- Đã gửi/từ chối thì phải có thành quả: link HOẶC ảnh.
  -- 'approved' cố ý không nằm trong danh sách: duyệt xong ảnh bị xoá ngay
  -- để tiết kiệm dung lượng, nên hàng đã duyệt được phép trống.
  constraint sub_result_required
    check (status not in ('submitted','rejected')
           or result_url is not null or evidence_path is not null),

  -- Link và ảnh là hai cách nộp khác nhau, không dùng cùng lúc
  constraint sub_one_proof
    check (not (result_url is not null and evidence_path is not null)),

  -- Đường dẫn tệp: thư mục đầu là uid người gửi, đuôi ảnh hoặc video hợp lệ
  constraint sub_evidence_path_check
    check (evidence_path is null
           or (char_length(evidence_path) <= 300
               and evidence_path ~ '^[A-Za-z0-9_./-]+$'
               and evidence_path ~* '\.(jpg|jpeg|png|webp|mp4|webm|mov|m4v)$')),

  -- Đã xử lý thì phải có dấu vết người duyệt + thời điểm
  constraint sub_reviewed_complete
    check (status not in ('approved','rejected','cancelled')
           or (reviewed_at is not null and reviewed_by is not null)),

  -- Từ chối thì BẮT BUỘC phải có lý do
  constraint sub_reject_needs_reason
    check (status <> 'rejected' or (admin_note is not null and char_length(trim(admin_note)) >= 3))
);

-- Sổ cái — append-only.
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid     not null references public.profiles(id) on delete cascade,
  amount_vnd bigint  not null check (amount_vnd <> 0),
  type       text     not null check (type in ('task_reward','payout','adjustment')),
  ref_id     uuid,
  note       text     not null default '',
  created_at timestamptz not null default now()
);

-- Nhật ký kiểm toán — append-only. Mỗi đồng tiền truy ngược được về 1 dòng.
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. INDEX
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists tasks_status_created_idx  on public.tasks(status, created_at desc);
create index if not exists tasks_type_idx            on public.tasks(task_type);
create index if not exists sub_worker_status_idx    on public.submissions(worker_id, status);
create index if not exists sub_task_idx             on public.submissions(task_id);
create index if not exists sub_queue_idx            on public.submissions(created_at)
  where status = 'submitted';
create index if not exists tx_user_idx              on public.transactions(user_id, created_at desc);
create index if not exists audit_created_idx         on public.audit_log(created_at desc);

-- 1 người chỉ giữ 1 lượt/lần trên 1 task (đang làm / chờ duyệt / bị từ chối)
create unique index if not exists sub_task_worker_held_uniq
  on public.submissions(task_id, worker_id)
  where status in ('in_progress','submitted','rejected');

-- 1 link thành quả chỉ được dùng ĐÚNG MỘT LẦN, trên mọi nhiệm vụ.
-- Phạm vi toàn cục chứ không phải (task_id, result_url): người nhận có thể
-- nhận 2 nhiệm vụ rồi dán cùng một link vào cả hai — đó là mẹo đẻ lượt.
drop index if exists public.sub_task_result_uniq;
create unique index if not exists sub_result_uniq
  on public.submissions(result_url)
  where result_url is not null;

-- Không được gửi lại chính link của nhiệm vụ gốc làm "thành quả"
create or replace function public.guard_result_url()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target text;
begin
  if new.result_url is null then return new; end if;
  select trim(target_url) into v_target from public.tasks where id = new.task_id;
  if trim(new.result_url) = v_target then
    raise exception 'Link thành quả không được trùng với link nhiệm vụ gốc.';
  end if;
  return new;
end $$;

drop trigger if exists sub_guard_result_url on public.submissions;
create trigger sub_guard_result_url
  before insert or update on public.submissions
  for each row execute function public.guard_result_url();

-- Tự tạo profile khi có user đăng ký mới
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. HÀM NỘI BỘ
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

create or replace function public.log_audit(
  p_action text, p_entity text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb))
$$;

create or replace function public.require_admin()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ quản trị viên mới được thực hiện thao tác này.';
  end if;
end $$;

-- Số nhiệm vụ tối đa được giữ đồng thời → chặn chiếm sân rồi bỏ
create or replace function public.max_held_slots() returns int
language sql immutable as $$ select 10 $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC — NGHIỆP VỤ NGƯỜI DÙNG
-- ────────────────────────────────────────────────────────────────────────────

-- Người đăng ký ĐẦU TIÊN nhận quyền admin. pg_advisory_xact_lock đảm bảo
-- đúng một giao dịch thắng kể cả khi nhiều người đăng ký cùng lúc.
create or replace function public.bootstrap_first_admin(p_full_name text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('bootstrap_first_admin_v1'));

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Hệ thống đã có quản trị viên. Hãy đăng nhập tài khoản admin hiện có.';
  end if;

  update public.profiles
     set role = 'admin',
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
   where id = auth.uid();

  if not found then
    raise exception 'Không tìm thấy hồ sơ người dùng.';
  end if;

  perform public.log_audit('bootstrap_admin', 'profile', auth.uid(),
                           jsonb_build_object('email', auth.email()));
end $$;

create or replace function public.update_my_profile(p_full_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
     set full_name = left(trim(coalesce(p_full_name, '')), 80)
   where id = auth.uid();
  if not found then raise exception 'Không tìm thấy hồ sơ người dùng.'; end if;
end $$;

-- NHẬN NHIỆM VỤ
-- Khóa FOR UPDATE trên task → mọi lệnh gọi song song đều xếp hàng,
-- nên không thể vượt quá số lượt dù bấm nhanh cỡ nào.
create or replace function public.claim_task(p_task_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t          public.tasks%rowtype;
  v_sub      uuid;
  v_held     int;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;

  select count(*) into v_held
    from public.submissions
   where worker_id = auth.uid()
     and status in ('in_progress','submitted','rejected');

  if v_held >= public.max_held_slots() then
    raise exception 'Bạn đang giữ tối đa % nhiệm vụ. Hãy gửi thành quả hoặc chờ duyệt trước khi nhận thêm.',
      public.max_held_slots();
  end if;

  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;

  if t.status <> 'open' then
    raise exception 'Nhiệm vụ này đã đóng, không nhận được nữa.';
  end if;
  if t.taken_count >= t.quantity then
    raise exception 'Nhiệm vụ đã hết lượt.';
  end if;
  if t.created_by = auth.uid() then
    raise exception 'Bạn không thể nhận nhiệm vụ do chính mình tạo.';
  end if;
  if t.deadline_at is not null and t.deadline_at < now() then
    raise exception 'Nhiệm vụ đã quá hạn.';
  end if;

  insert into public.submissions (task_id, worker_id, price_vnd)
  values (t.id, auth.uid(), t.price_vnd)
  returning id into v_sub;

  update public.tasks
     set taken_count = taken_count + 1,
         status = case when taken_count + 1 >= quantity then 'closed' else 'open' end
   where id = t.id;

  perform public.log_audit('claim_task', 'submission', v_sub,
    jsonb_build_object('task_id', t.id, 'price_vnd', t.price_vnd));

  return v_sub;
end $$;

-- GỬI LINK THÀNH QUẢ
create or replace function public.submit_result(
  p_submission_id uuid, p_result_url text, p_note text default '',
  p_evidence_path text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s     public.submissions%rowtype;
  t     public.tasks%rowtype;
  v_res text;
  v_ev  text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;

  v_res := trim(coalesce(p_result_url, ''));
  v_ev  := trim(coalesce(p_evidence_path, ''));

  -- Ảnh phải nằm trong thư mục của chính người gửi (thư mục đầu = uid).
  if v_ev <> '' then
    if char_length(v_ev) > 300 or v_ev !~ '^[A-Za-z0-9_./-]+$' then
      raise exception 'Đường dẫn ảnh không hợp lệ.';
    end if;
    if split_part(v_ev, '/', 1) <> auth.uid()::text then
      raise exception 'Ảnh bằng chứng phải nằm trong thư mục của chính bạn.';
    end if;
  end if;

  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Không tìm thấy lượt nhiệm vụ.'; end if;
  if s.worker_id <> auth.uid() then
    raise exception 'Đây không phải lượt nhiệm vụ của bạn.';
  end if;
  if s.status not in ('in_progress','rejected') then
    raise exception 'Không thể gửi thành quả ở trạng thái hiện tại (%).', s.status;
  end if;

  select * into t from public.tasks where id = s.task_id;
  if t.deadline_at is not null and t.deadline_at < now() then
    raise exception 'Đã quá hạn nộp thành quả.';
  end if;

  if t.task_type = 'link' then
    -- Nhiệm vụ vượt link: đúng như cũ, bắt buộc link http(s).
    if v_res !~* '^https?://' then
      raise exception 'Với nhiệm vụ vượt link, kết quả phải là đường dẫn bắt đầu bằng http:// hoặc https://';
    end if;
    if char_length(v_res) > 1000 then raise exception 'Link quá dài (tối đa 1000 ký tự).'; end if;
    if v_res = trim(coalesce(t.target_url, '')) then
      raise exception 'Link này giống hệt link nhiệm vụ gốc, không phải kết quả.';
    end if;
  else
    -- Nhiệm vụ khác: KHÔNG bắt buộc https:// nữa, nộp ảnh là được.
    -- Thứ tự kiểm tra: dán link vào nhiệm vụ ảnh thì báo đúng lý do, đừng bắt
    -- người dùng tự đoán.
    if v_res <> '' then
      raise exception 'Nhiệm vụ này nộp ảnh, đừng dán link vào nữa.';
    end if;
    if v_ev = '' then
      raise exception 'Nhiệm vụ này cần ảnh chứng minh đã hoàn thành, không phải link.';
    end if;
  end if;

  update public.submissions
     set result_url    = nullif(v_res, ''),
         evidence_path = nullif(v_ev, ''),
         note          = left(coalesce(p_note, ''), 500),
         status        = 'submitted',
         submitted_at  = now()
   where id = p_submission_id;

  perform public.log_audit('submit_result', 'submission', p_submission_id,
    jsonb_build_object('has_evidence', v_ev <> '', 'task_type', t.task_type));
end $$;

-- LẤY LINK CẦN VƯỢT
-- Worker chỉ lấy được sau khi đã nhận lượt. Admin xem được mọi nơi.
create or replace function public.get_target_url(p_submission_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_url text; v_task uuid;
begin
  select task_id into v_task from public.submissions where id = p_submission_id;
  if v_task is null then return null; end if;
  if not public.is_admin() then
    if not exists (
      select 1 from public.submissions
       where id = p_submission_id and worker_id = auth.uid()
         and status in ('in_progress','submitted','rejected')
    ) then
      return null;
    end if;
  end if;
  select target_url into v_url from public.tasks where id = v_task;
  return v_url;
end $$;

-- BỎ LƯỢT — người nhận tự trả lượt về kho.
-- Không có hàm này thì giới hạn 10 lượt đang giú sẽ thành cái bẫy: nhận xong
-- không làm nổi thì bị kẹt vĩnh viễn, không nhận được nhiệm vụ mới.
drop function if exists public.cancel_my_submission(uuid);

create or replace function public.cancel_my_submission(p_submission_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s     public.submissions%rowtype;
  v_ev  text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;

  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Không tìm thấy lượt nhiệm vụ.'; end if;
  if s.worker_id <> auth.uid() then
    raise exception 'Đây không phải lượt nhiệm vụ của bạn.';
  end if;
  if s.status not in ('in_progress','rejected') then
    raise exception 'Chỉ bỏ được lượt chưa gửi duyệt. Lượt đang chờ duyệt không thể bỏ.';
  end if;

  v_ev := s.evidence_path;

  update public.submissions
     set status = 'cancelled', admin_note = 'Người nhận tự bỏ lượt',
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_submission_id;

  update public.tasks
     set taken_count = greatest(taken_count - 1, 0),
         status = case when greatest(taken_count - 1, 0) < quantity then 'open' else status end
   where id = s.task_id;

  perform public.log_audit('worker_cancel','submission',p_submission_id);
  return v_ev;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC — QUẢN TRỊ
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_create_task(
  p_title text, p_description text, p_target_url text,
  p_task_type text, p_price_vnd bigint, p_quantity int,
  p_deadline_at timestamptz, p_priority text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_url text;
begin
  perform public.require_admin();
  if p_task_type not in ('link','other') then raise exception 'Loại nhiệm vụ không hợp lệ.'; end if;

  if p_task_type = 'link' then
    if trim(coalesce(p_target_url,'')) !~* '^https?://' then
      raise exception 'Nhiệm vụ vượt link bắt buộc phải có link bắt đầu bằng http:// hoặc https://';
    end if;
    v_url := left(trim(p_target_url), 2000);
  else
  if p_task_type = 'other' then
    if char_length(trim(coalesce(p_description,''))) < 10 then
      raise exception 'Nhiệm vụ khác bắt buộc phải có mô tả công việc (tối thiểu 10 ký tự).';
    end if;
    if trim(coalesce(p_target_url,'')) <> '' then
      raise exception 'Nhiệm vụ khác không dùng link. Bỏ trống ô link, hoặc chuyển sang loại “Vượt link”.';
    end if;
    -- Chuyển sang "khác" là xoá link cũ cho sạch.
    v_url := null;

  if p_deadline_at is not null and p_deadline_at <= now() then
    raise exception 'Hạn nộp phải nằm ở tương lai.';
  end if;

  insert into public.tasks
    (title, description, task_type, target_url, price_vnd, quantity, deadline_at, priority, created_by)
  values
    (trim(p_title), left(coalesce(p_description,''),2000), p_task_type,
     v_url, p_price_vnd, p_quantity, p_deadline_at, p_priority, auth.uid())
  returning id into v_id;

  perform public.log_audit('create_task','task',v_id,
    jsonb_build_object('price_vnd', p_price_vnd, 'quantity', p_quantity, 'task_type', p_task_type));
  return v_id;
end $$;

create or replace function public.admin_update_task(
  p_task_id uuid, p_title text, p_description text, p_target_url text,
  p_task_type text, p_price_vnd bigint, p_quantity int,
  p_deadline_at timestamptz, p_priority text, p_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url text;
begin
  perform public.require_admin();
  if p_task_type not in ('link','other') then raise exception 'Loại nhiệm vụ không hợp lệ.'; end if;

  if p_task_type = 'other' then
    if char_length(trim(coalesce(p_description,''))) < 10 then
      raise exception 'Nhiệm vụ khác bắt buộc phải có mô tả công việc (tối thiểu 10 ký tự).';
    end if;
    if trim(coalesce(p_target_url,'')) <> '' then
      raise exception 'Nhiệm vụ khác không dùng link. Bỏ trống ô link, hoặc chuyển sang loại “Vượt link”.';
    end if;
    -- Chuyển sang "khác" là xoá link cũ cho sạch.
    v_url := null;
  else
    if trim(coalesce(p_target_url,'')) = '' then
      -- Rỗng = giữ nguyên link cũ. Một lần sửa nhầm không được ghi đè link
      -- thật bằng chuỗi rỗng và làm hỏng cả nhiệm vụ.
      v_url := null;
    else
      if trim(p_target_url) !~* '^https?://' then
        raise exception 'Link phải bắt đầu bằng http:// hoặc https://';
      end if;
      v_url := left(trim(p_target_url), 2000);
    end if;
  end if;

  if p_status = 'closed' and exists (
    select 1 from public.submissions
     where task_id = p_task_id and status in ('in_progress','submitted','rejected')
  ) then
    raise exception 'Còn lượt chưa xử lý, không thể đóng nhiệm vụ.';
  end if;
  if p_quantity < (select count(*)::int from public.submissions where task_id = p_task_id) then
    raise exception 'Số lượng không thể nhỏ hơn số lượt đã nhận.';
  end if;

  update public.tasks set
    title = trim(p_title),
    description = left(coalesce(p_description,''),2000),
    task_type = p_task_type,
    target_url = coalesce(v_url, target_url),
    price_vnd = p_price_vnd,
    quantity = p_quantity,
    deadline_at = p_deadline_at,
    priority = p_priority,
    status = case when taken_count >= p_quantity then 'closed' else p_status end
  where id = p_task_id;

  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  perform public.log_audit('update_task','task',p_task_id,
    jsonb_build_object('price_vnd', p_price_vnd, 'task_type', p_task_type));
end $$;

create or replace function public.admin_delete_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  if exists (select 1 from public.submissions
              where task_id = p_task_id and status <> 'cancelled') then
    raise exception 'Nhiệm vụ đã có người nhận. Hãy đóng nhiệm vụ thay vì xoá.';
  end if;
  delete from public.tasks where id = p_task_id;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  perform public.log_audit('delete_task','task',p_task_id);
end $$;

-- DUYỆT / TỪ CHỐI
-- Khóa FOR UPDATE + guard status='submitted' ⇒ bấm Duyệt 2 lần chỉ cộng tiền 1 lần.
drop function if exists public.admin_review_submission(uuid, boolean, text);

create or replace function public.admin_review_submission(
  p_submission_id uuid, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s     public.submissions%rowtype;
  v_ev  text;
begin
  perform public.require_admin();

  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Không tìm thấy lượt nhiệm vụ.'; end if;
  if s.worker_id = auth.uid() then
    raise exception 'Không thể tự duyệt nhiệm vụ của chính mình.';
  end if;
  if s.status <> 'submitted' then
    raise exception 'Lượt này không ở hàng đợi chờ duyệt (hiện tại: %).', s.status;
  end if;

  if p_approve then
    v_ev := s.evidence_path;

    update public.submissions
       set status = 'approved', admin_note = nullif(trim(p_note), ''),
           reviewed_at = now(), reviewed_by = auth.uid(),
           -- Ảnh đã kiểm xong thì không giữ lại: xoá để tiết kiệm Storage.
           evidence_path = null,
           result_url = case when v_ev is not null then null else result_url end
     where id = p_submission_id;

    insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
    values (s.worker_id, s.price_vnd, 'task_reward', p_submission_id, 'Thưởng hoàn thành nhiệm vụ');

    perform public.log_audit('approve','submission',p_submission_id,
      jsonb_build_object('amount_vnd', s.price_vnd, 'worker_id', s.worker_id,
                         'evidence_path', v_ev));
  else
    if char_length(trim(coalesce(p_note,''))) < 3 then
      raise exception 'Phải nêu lý do từ chối (tối thiểu 3 ký tự).';
    end if;
    -- Từ chối thì GIỮ ảnh lại: người nhận còn xem lại được, và sẽ xoá
    -- khi nộp ảnh mới hoặc khi bỏ lượt.
    update public.submissions
       set status = 'rejected', admin_note = trim(p_note),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_submission_id;

    perform public.log_audit('reject','submission',p_submission_id,
      jsonb_build_object('note', p_note));
    v_ev := null;
  end if;

  return v_ev;
end $$;

-- THU HỒI LƯỢT — trả lượt về kho
drop function if exists public.admin_release_slot(uuid, text);

create or replace function public.admin_release_slot(
  p_submission_id uuid, p_note text default ''
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s     public.submissions%rowtype;
  v_ev  text;
begin
  perform public.require_admin();
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Không tìm thấy lượt nhiệm vụ.'; end if;
  if s.status not in ('in_progress','rejected') then
    raise exception 'Chỉ thu hồi được lượt đang làm hoặc bị từ chối (hiện tại: %).', s.status;
  end if;

  v_ev := s.evidence_path;

  update public.submissions
     set status = 'cancelled', admin_note = nullif(trim(p_note), ''),
         reviewed_at = now(), reviewed_by = auth.uid(),
         evidence_path = null
   where id = p_submission_id;

  update public.tasks
     set taken_count = greatest(taken_count - 1, 0),
         status = case when greatest(taken_count - 1, 0) < quantity then 'open' else status end
   where id = s.task_id;

  perform public.log_audit('release_slot','submission',p_submission_id);
  return v_ev;
end $$;

-- ẢNH TỒN — admin bấm nút "Dọn ảnh tồn" gọi hàm này.
-- Mỗi lần duyệt đều ghi evidence_path vào audit_log, nên kể cả phiên đăng
-- nhập bị tắt giữa chừng (client chưa kịp xoá file) thì vẫn quét lại được.
-- Xoá file đã không tồn tại là thành công nên chạy lại vô hại.
create or replace function public.admin_evidence_orphans()
returns text[] language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[];
begin
  perform public.require_admin();
  select coalesce(array_agg(distinct a.payload->>'evidence_path'), '{}')
    into v
    from public.audit_log a
   where a.action = 'approve'
     and a.payload ? 'evidence_path'
     and a.payload->>'evidence_path' is not null
     and a.payload->>'evidence_path' <> '';
  return v;
end $$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  if p_role not in ('admin','worker') then raise exception 'Quyền không hợp lệ.'; end if;
  if p_user_id = auth.uid() then
    raise exception 'Không thể tự đổi quyền của chính mình.';
  end if;
  if p_role = 'worker' and exists (
    select 1 from public.profiles where id = p_user_id and role = 'admin'
  ) and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Phải còn ít nhất một quản trị viên.';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Không tìm thấy người dùng.'; end if;
  perform public.log_audit('set_role','profile',p_user_id, jsonb_build_object('role', p_role));
end $$;

-- ĐIỀU CHỈNH SỐ DƯ — chỉ ghi thêm dòng ledger, KHÔNG sửa số dư
create or replace function public.admin_adjust_balance(
  p_user_id uuid, p_amount_vnd bigint, p_note text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  if p_amount_vnd = 0 then raise exception 'Số tiền điều chỉnh không được bằng 0.'; end if;
  if char_length(trim(coalesce(p_note,''))) < 3 then
    raise exception 'Phải nêu lý do điều chỉnh (tối thiểu 3 ký tự).';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Không tìm thấy người dùng.';
  end if;

  insert into public.transactions (user_id, amount_vnd, type, note)
  values (p_user_id, p_amount_vnd, 'adjustment', trim(p_note));

  perform public.log_audit('adjust_balance','profile',p_user_id,
    jsonb_build_object('amount_vnd', p_amount_vnd, 'note', p_note));
end $$;

-- RÚT TIỀN — admin đánh dấu đã chuyển khoản
create or replace function public.admin_payout(
  p_user_id uuid, p_amount_vnd bigint, p_note text default 'Rút tiền'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_balance bigint;
begin
  perform public.require_admin();
  if p_amount_vnd <= 0 then raise exception 'Số tiền rút phải lớn hơn 0.'; end if;

  select coalesce(sum(amount_vnd), 0) into v_balance
    from public.transactions where user_id = p_user_id;

  if p_amount_vnd > v_balance then
    raise exception 'Số dư không đủ (đang có %).', v_balance;
  end if;

  insert into public.transactions (user_id, amount_vnd, type, note)
  values (p_user_id, -p_amount_vnd, 'payout', trim(p_note));

  perform public.log_audit('payout','profile',p_user_id, jsonb_build_object('amount_vnd', p_amount_vnd));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. VIEW
-- ────────────────────────────────────────────────────────────────────────────

-- Bảng nhiệm vụ công khai. CỐ TÝNH KHÔNG có cột target_url.
drop view if exists public.v_tasks;
create view public.v_tasks as
select
  t.id, t.title, t.description, t.task_type, t.price_vnd,
  t.quantity, t.taken_count,
  greatest(t.quantity - t.taken_count, 0)::int as remaining,
  case when t.taken_count >= t.quantity then 'closed'::text else t.status end as status,
  t.priority, t.deadline_at, t.created_by, t.created_at
from public.tasks t;

-- Số dư = TỔNG SỔ CÁI. Không có cột nào để "lệch".
drop view if exists public.v_wallet;
create view public.v_wallet with (security_invoker = true) as
select
  p.id as user_id,
  coalesce(sum(t.amount_vnd), 0)::bigint as balance_vnd,
  coalesce(sum(t.amount_vnd) filter (where t.amount_vnd > 0), 0)::bigint as total_earned_vnd,
  coalesce(-sum(t.amount_vnd) filter (where t.amount_vnd < 0), 0)::bigint as total_paid_vnd,
  count(t.id)::bigint as tx_count,
  max(t.created_at) as last_activity_at
from public.profiles p
left join public.transactions t on t.user_id = p.id
group by p.id;

-- Danh sách lượt nhiệm vụ. Worker không thể join bảng tasks (RLS chặn),
-- nên view này tự lọc: chỉ trả về lượt của chính người gọi, admin thì thấy tất cả.
drop view if exists public.v_submissions;
create view public.v_submissions as
select
  s.id, s.task_id, s.worker_id, s.result_url, s.note, s.price_vnd, s.status,
  s.admin_note, s.created_at, s.submitted_at, s.reviewed_at, s.evidence_path,
  t.title, t.description, t.task_type, t.priority, t.deadline_at, t.created_by
from public.submissions s
join public.tasks t on t.id = s.task_id
where auth.uid() is not null
  and (s.worker_id = auth.uid() or public.is_admin());

-- Thống kê cho dashboard admin
drop view if exists public.v_admin_stats;
create view public.v_admin_stats as
select
  (select count(*) from public.tasks where status = 'open')::int as tasks_open,
  (select count(*) from public.submissions where status = 'submitted')::int as waiting_review,
  (select count(*) from public.submissions where status = 'in_progress')::int as in_progress,
  (select count(*) from public.profiles where role = 'worker')::int as workers,
  (select coalesce(sum(amount_vnd),0) from public.transactions
     where type = 'task_reward' and created_at > now() - interval '30 days')::bigint as paid_30d,
  (select coalesce(sum(amount_vnd),0) from public.transactions
     where type = 'task_reward' and created_at > now() - interval '1 day')::bigint as paid_24h;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.tasks        enable row level security;
alter table public.submissions  enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_log    enable row level security;

drop policy if exists p_sel on public.profiles;
create policy p_sel on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- Không có policy INSERT/UPDATE/DELETE cho profiles
-- → không ai sửa được role của chính mình bằng đường trực tiếp.

-- tasks: chỉ admin đọc được bảng gốc (chứa target_url)
drop policy if exists t_sel on public.tasks;
create policy t_sel on public.tasks for select using (public.is_admin());

drop policy if exists t_ins on public.tasks;
create policy t_ins on public.tasks for insert with check (public.is_admin());

drop policy if exists t_upd on public.tasks;
create policy t_upd on public.tasks for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists t_del on public.tasks;
create policy t_del on public.tasks for delete using (public.is_admin());

drop policy if exists s_sel on public.submissions;
create policy s_sel on public.submissions for select
  using (worker_id = auth.uid() or public.is_admin());

drop policy if exists tx_sel on public.transactions;
create policy tx_sel on public.transactions for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists a_sel on public.audit_log;
create policy a_sel on public.audit_log for select using (public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- 8. GRANT — siết chặt tay
-- ────────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.submissions, public.transactions to authenticated;
grant select on public.v_tasks, public.v_wallet, public.v_submissions to authenticated;
grant select on public.tasks        to authenticated;  -- RLS lọc: worker thấy 0 dòng
grant select on public.audit_log, public.v_admin_stats to authenticated;

-- Bất biến: không ai sửa/xoá sổ cái và nhật ký
revoke insert, update, delete on public.transactions from anon, authenticated;
revoke insert, update, delete on public.audit_log    from anon, authenticated;
revoke insert, update, delete on public.profiles, public.submissions from anon;

-- Mặc định Postgres cấp EXECUTE cho PUBLIC trên mọi function → phải thu hồi
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'claim_task','submit_result','get_target_url','cancel_my_submission',
      'admin_evidence_orphans',
      'admin_create_task','admin_update_task','admin_delete_task',
      'admin_review_submission','admin_release_slot','admin_set_role',
      'admin_adjust_balance','admin_payout',
      'bootstrap_first_admin','update_my_profile',
      'current_role','is_admin','log_audit','require_admin',
      'max_held_slots','handle_new_user','guard_result_url'
    )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon',    f.sig);
  end loop;
end $$;

-- Chỉ cấp cho các hàm frontend thực sự gọi.
-- (is_admin / current_role phải được cấp vì RLS policy gọi chúng.)
grant execute on function public.claim_task(uuid) to authenticated;
grant execute on function public.submit_result(uuid, text, text, text) to authenticated;
grant execute on function public.get_target_url(uuid) to authenticated;
grant execute on function public.cancel_my_submission(uuid) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_create_task(text,text,text,text,bigint,int,timestamptz,text) to authenticated;
grant execute on function public.admin_update_task(uuid,text,text,text,text,bigint,int,timestamptz,text,text) to authenticated;
grant execute on function public.admin_delete_task(uuid) to authenticated;
grant execute on function public.admin_review_submission(uuid,boolean,text) to authenticated;
grant execute on function public.admin_release_slot(uuid,text) to authenticated;
grant execute on function public.admin_set_role(uuid,text) to authenticated;
grant execute on function public.admin_adjust_balance(uuid,bigint,text) to authenticated;
grant execute on function public.admin_payout(uuid,bigint,text) to authenticated;

-- ---------------------------------------------------------------------------
-- KHÔNG cấp EXECUTE cho bootstrap_first_admin.
-- Trên một trang public, "ai đăng ký trước thì làm admin" là lỗ hổng mở
-- đường cho bất kỳ ai chạy nhanh hơn chủ sở hữu. Cấp quyền admin chỉ còn
-- một cách: chạy scripts/make-admin.sql với email cụ thể.
--
-- Phải REVOKE tường minh khỏi authenticated: câu trên chỉ thu hồi quyền
-- của PUBLIC/anon, không gỡ được grant đã cấp riêng cho authenticated.
revoke execute on function public.bootstrap_first_admin(text) from authenticated;
-- ---------------------------------------------------------------------------

-- ────────────────────────────────────────────────────────────────────────────
-- 9. THÔNG BÁO
-- ────────────────────────────────────────────────────────────────────────────
comment on view public.v_wallet is
  'Số dư được TÍNH từ sổ cái, không lưu cột. Không thể lệch.';
comment on table public.transactions is
  'Sổ cái append-only: mọi sửa lỗi phải tạo dòng điều chỉnh, không bao giờ sửa/xoá dòng cũ.';
comment on table public.audit_log is
  'Nhật ký kiểm toán append-only. Mỗi động tiền truy ngược được về một dòng.';

-- ============================================================================
-- ============================================================================
--  9b. KHO TỆP THÀNH QUẢ (ẢNH / VIDEO)
--
--  Bucket private: không có link có chữ ký thì không ai xem được tệp, kể cả
--  admin. Đường dẫn luôn bắt đầu bằng uid người gửi.
--
--  KHÔNG có policy DELETE là lỗi chết người: ảnh không bao giờ xoá được, và
--  người nhận không thay được ảnh cũ khi bị từ chối.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- 20 MB vì có video: tệp thành quả là ẢNH hoặc VIDEO.
-- Lưu ý dung lượng: mặc định Supabase có 1 GB, nên nếu tồn đọng nhiều video
-- chờ duyệt cùng lúc thì hết chỗ. Video vẫn bị xoá ngay khi admin duyệt.
values ('task-evidence', 'task-evidence', false, 20971520,
        array['image/jpeg','image/png','image/webp',
              'video/mp4','video/webm','video/quicktime','video/x-m4v'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Người nhận chỉ ghi được vào thư mục tên mình (thư mục đầu tiên = uid).
drop policy if exists evidence_insert on storage.objects;
create policy evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Xem tệp: chủ tệp hoặc admin. Không có policy UPDATE ⇒ ảnh bất biến sau khi
-- nộp, không ai lén thay ảnh rồi mới gửi duyệt.
drop policy if exists evidence_read on storage.objects;
create policy evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-evidence'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Xoá: chủ tệp (thay khi bị từ chối, dọn khi bỏ lượt) và admin (dọn tệp
-- tồn sau khi duyệt).
drop policy if exists evidence_delete on storage.objects;
create policy evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-evidence'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Postgres KHÔNG xoá được file trong Storage — đó là dịch vụ riêng, cần
-- service key mà frontend không được có. Nên admin_review_submission trả về
-- đường dẫn tệp đã xoá khỏi database, client dùng đường dẫn đó để xoá file.
-- Nếu client chết giữa chừng thì admin_evidence_orphans() quét lại được.

--  10. RÚT TIỀN
--
--  Nguyên tắc: tiền bị TRỪ ngay khi tạo yêu cầu, ghi thẳng vào sổ cái.
--  Không có cột "số dư" nào bị đụng tới, nên không thể lệch.
--  Admin từ chối → ghi thêm một dòng hoàn tiền (refund), không sửa dòng cũ.
-- ============================================================================

-- Sổ cái: thêm hai loại giao dịch
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('task_reward','payout','adjustment','withdraw_request','refund'));

create table if not exists public.withdrawal_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  method       text not null check (method in ('bank','card')),
  amount_vnd   bigint not null check (amount_vnd > 0),
  status       text not null default 'pending'
               check (status in ('pending','processing','approved','rejected','cancelled')),

  -- chuyển khoản ngân hàng
  bank_code    text not null default '',
  bank_holder  text not null default '',
  bank_number  text not null default '',

  -- thẻ nạp
  card_brand   text not null default '',
  card_serial  text not null default '',
  card_code    text not null default '',

  note         text not null default '',
  admin_note   text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id),

  -- Thẻ nạp chỉ được nhận đúng 6 mệnh giá này.
  -- Ràng buộc ở tầng bảng nên không có đường nào lách được, kể cả gọi API trực tiếp.
  constraint wd_card_denom_allowed check (
    method <> 'card'
    or amount_vnd in (5000, 10000, 20000, 50000, 100000, 200000)
  ),
  constraint wd_card_fields check (
    method <> 'card' or (length(trim(card_brand)) >= 2 and length(trim(card_code)) >= 6)
  ),
  constraint wd_bank_fields check (
    method <> 'bank'
    or (length(trim(bank_holder)) >= 2 and length(trim(bank_number)) between 6 and 34
        and length(trim(bank_code)) >= 2)
  ),
  -- đã xử lý thì phải có người duyệt và thời điểm
  constraint wd_reviewed_complete check (
    status not in ('approved','rejected','cancelled')
    or (reviewed_at is not null and reviewed_by is not null)
  ),
  constraint wd_reject_needs_reason check (
    status <> 'rejected' or (admin_note is not null and char_length(trim(admin_note)) >= 3)
  )
);

create index if not exists wd_user_idx   on public.withdrawal_requests(user_id, created_at desc);
create index if not exists wd_queue_idx  on public.withdrawal_requests(created_at)
  where status in ('pending','processing');

alter table public.withdrawal_requests enable row level security;

drop policy if exists wd_sel on public.withdrawal_requests;
create policy wd_sel on public.withdrawal_requests for select
  using (user_id = auth.uid() or public.is_admin());
-- KHÔNG có policy insert/update/delete → mọi ghi đi qua RPC.

-- Danh sách rút tiền kèm thông tin người dùng (chỉ admin xem được nhiều dòng)
drop view if exists public.v_withdrawals;
create view public.v_withdrawals with (security_invoker = true) as
select w.*, p.email as user_email, p.full_name as user_name
from public.withdrawal_requests w
join public.profiles p on p.id = w.user_id;

-- Số dư đang "bay" trong các yêu cầu chờ xử lý
drop view if exists public.v_wallet;
create view public.v_wallet with (security_invoker = true) as
select
  p.id as user_id,
  coalesce(sum(t.amount_vnd), 0)::bigint as balance_vnd,
  coalesce(sum(t.amount_vnd) filter (where t.amount_vnd > 0), 0)::bigint as total_earned_vnd,
  coalesce(-sum(t.amount_vnd) filter (where t.amount_vnd < 0), 0)::bigint as total_paid_vnd,
  coalesce(sum(t.amount_vnd) filter (where t.type = 'withdraw_request'), 0)::bigint as pending_withdraw_vnd,
  count(t.id)::bigint as tx_count,
  max(t.created_at) as last_activity_at
from public.profiles p
left join public.transactions t on t.user_id = p.id
group by p.id;

-- Hàm create_withdrawal_request được định nghĩa ở MỤC 11 (bản ba phương thức:
-- game / card / bank). Bản ở đây đã bị gỡ vì trùng chữ ký nhưng khác tên tham số,
-- khiến PostgreSQL báo lỗi "cannot change name of input parameter" nếu chạy lại schema.

-- ── RPC: người dùng tự huỷ yêu cầu đang chờ ────────────────────────────────
create or replace function public.cancel_withdrawal(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.withdrawal_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;

  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu rút tiền.'; end if;
  if w.user_id <> auth.uid() then raise exception 'Đây không phải yêu cầu của bạn.'; end if;
  if w.status <> 'pending' then
    raise exception 'Chỉ huỷ được yêu cầu đang chờ (hiện tại: %).', w.status;
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;

  update public.withdrawal_requests
     set status = 'cancelled', reviewed_at = now(), reviewed_by = auth.uid(),
         admin_note = 'Người dùng tự huỷ'
   where id = p_id;

  insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
  values (auth.uid(), w.amount_vnd, 'refund', p_id, 'Hoàn tiền do tự huỷ yêu cầu rút');

  perform public.log_audit('cancel_withdrawal','withdrawal', p_id,
    jsonb_build_object('amount_vnd', w.amount_vnd));
end $$;

-- ── RPC: admin xử lý yêu cầu rút tiền ─────────────────────────────────────
create or replace function public.admin_review_withdrawal(
  p_id uuid, p_status text, p_note text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.withdrawal_requests%rowtype;
begin
  perform public.require_admin();
  if p_status not in ('processing','approved','rejected') then
    raise exception 'Trạng thái không hợp lệ.';
  end if;

  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu rút tiền.'; end if;
  if w.status not in ('pending','processing') then
    raise exception 'Yêu cầu này đã ở trạng thái % — không xử lý lại được.', w.status;
  end if;
  if w.user_id = auth.uid() then
    raise exception 'Không thể tự duyệt yêu cầu rút của chính mình.';
  end if;

  if p_status = 'rejected' then
    if char_length(trim(coalesce(p_note,''))) < 3 then
      raise exception 'Phải nêu lý do từ chối (tối thiểu 3 ký tự).';
    end if;
    perform 1 from public.profiles where id = w.user_id for update;
    update public.withdrawal_requests
       set status = 'rejected', admin_note = trim(p_note),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_id;
    -- Hoàn tiền: thêm dòng ledger, không sửa dòng đã trừ
    insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
    values (w.user_id, w.amount_vnd, 'refund', p_id, 'Hoàn tiền do yêu cầu bị từ chối');
    perform public.log_audit('reject_withdrawal','withdrawal',p_id,
      jsonb_build_object('amount_vnd', w.amount_vnd, 'note', p_note));
  else
    update public.withdrawal_requests
       set status = p_status, admin_note = nullif(trim(p_note),''),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_id;
    perform public.log_audit(p_status || '_withdrawal','withdrawal',p_id,
      jsonb_build_object('amount_vnd', w.amount_vnd));
  end if;
end $$;

-- ── Grant ─────────────────────────────────────────────────────────────────
revoke all on public.withdrawal_requests from anon, authenticated;
grant select on public.withdrawal_requests to authenticated;
grant select on public.v_withdrawals to authenticated;
revoke insert, update, delete on public.withdrawal_requests from anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_withdrawal_request','cancel_withdrawal','admin_review_withdrawal')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon',    f.sig);
  end loop;
end $$;

-- (grant cho create_withdrawal_request nằm ở mục 11)

grant execute on function public.cancel_withdrawal(uuid) to authenticated;
grant execute on function public.admin_review_withdrawal(uuid,text,text) to authenticated;

-- ============================================================================
--  11. SỬA MÔ HÌNH RÚT TIỀN
--
--  Mô hình cũ cho người rút TỰ NHẬP "mã thẻ" — sai ngay từ gốc. Rút tiền
--  là người rút NHẬN tiền/thẻ, không phải mang thẻ tới nộp. Nay tách làm
--  ba phương thức với ba loại hàng hóa khác nhau:
--
--    bank  — chuyển khoản ngân hàng: admin chuyển khoản ra ngoài
--    game  — nạp thẳng vào game:   admin nạp vào tài khoản game của người rút
--    card  — thẻ cào:              ADMIN gửi mã thẻ, người rút chỉ chờ nhận
--
--  Riêng 'card' mới cần mã thẻ, và mã đó do admin nhập lúc giao, không phải
--  người rút. Không thể đánh dấu hoàn thành khi chưa có mã.
-- ============================================================================

alter table public.withdrawal_requests drop constraint if exists wd_card_fields;
alter table public.withdrawal_requests drop constraint if exists wd_card_denom_allowed;
alter table public.withdrawal_requests drop constraint if exists wd_bank_fields;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_method_check;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_status_check;

-- gỡ cả tên ràng buộc của lần định nghĩa trước, không chỉ tên cũ
alter table public.withdrawal_requests
  drop constraint if exists wd_denom_allowed;
alter table public.withdrawal_requests
  drop constraint if exists wd_fields_required;
alter table public.withdrawal_requests
  drop constraint if exists wd_card_delivered;
alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_method_check;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_method_check
  check (method in ('bank','game','card'));

alter table public.withdrawal_requests
  add column if not exists game_platform   text not null default '',
  add column if not exists game_account_id text not null default '';

-- thẻ nạp & nạp game: chỉ nhận 6 mệnh giá; ngân hàng thì tự do (>= 10.000)
alter table public.withdrawal_requests
  add constraint wd_denom_allowed check (
    method = 'bank' or amount_vnd in (5000, 10000, 20000, 50000, 100000, 200000)
  );

-- mỗi phương thức đòi đúng thông tin của nó
alter table public.withdrawal_requests
  add constraint wd_fields_required check (
    case method
      when 'bank' then length(trim(bank_holder)) >= 2
                   and length(trim(bank_number)) between 6 and 34
                   and length(trim(bank_code)) >= 2
      when 'game' then length(trim(game_platform)) >= 2
                   and length(trim(game_account_id)) between 4 and 40
      when 'card' then length(trim(card_brand)) >= 2
      else false
    end
  );

-- Không được báo "đã hoàn thành" một yêu cầu thẻ cào khi chưa có mã thẻ.
alter table public.withdrawal_requests
  add constraint wd_card_delivered check (
    status <> 'approved' or method <> 'card' or length(trim(card_code)) >= 6
  );

-- ── RPC tạo yêu cầu (thay thế bản cũ vốn bắt người dùng nhập mã thẻ) ─────
drop function if exists public.create_withdrawal_request(text,bigint,text,text,text,text,text,text,text);

create or replace function public.create_withdrawal_request(
  p_method text, p_amount_vnd bigint,
  p_bank_code text default '', p_bank_holder text default '', p_bank_number text default '',
  p_game_platform text default '', p_game_account_id text default '',
  p_card_brand text default '',
  p_note text default ''
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_balance bigint;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_method not in ('bank','game','card') then raise exception 'Phương thức rút không hợp lệ.'; end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then raise exception 'Số tiền rút không hợp lệ.'; end if;
  if p_method = 'bank' and p_amount_vnd < 10000 then
    raise exception 'Rút chuyển khoản tối thiểu 10.000 ₫.';
  end if;

  -- khoá dòng profile trước khi đọc số dư → các yêu cầu xếp hàng,
  -- không ai rút được vượt số dư dù gửi cùng lúc bao nhiêu lần
  perform 1 from public.profiles where id = auth.uid() for update;
  select coalesce(sum(amount_vnd), 0) into v_balance
    from public.transactions where user_id = auth.uid();
  -- Âm là "đang nợ": phải báo đúng tình huống, không phải "số dư không đủ",
  -- vì hai lỗi này dẫn người dùng đi hai hướng khác nhau (bù nợ vs kiếm thêm).
  if v_balance <= 0 then
    raise exception 'Bạn đang nợ % ₫. Hãy nhận và hoàn thành nhiệm vụ để kiếm bù về 0 trước khi rút tiền.', -v_balance;
  end if;
  if p_amount_vnd > v_balance then
    raise exception 'Số dư không đủ. Bạn đang có % ₫.', v_balance;
  end if;

  insert into public.withdrawal_requests
    (user_id, method, amount_vnd, bank_code, bank_holder, bank_number,
     game_platform, game_account_id, card_brand, note)
  values
    (auth.uid(), p_method, p_amount_vnd, left(trim(coalesce(p_bank_code,'')),20),
     left(trim(coalesce(p_bank_holder,'')),80), left(trim(coalesce(p_bank_number,'')),34),
     left(trim(coalesce(p_game_platform,'')),40), left(trim(coalesce(p_game_account_id,'')),40),
     left(trim(coalesce(p_card_brand,'')),40), left(coalesce(p_note,''),300))
  returning id into v_id;

  insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
  values (auth.uid(), -p_amount_vnd, 'withdraw_request', v_id,
    case p_method
      when 'bank' then 'Rút tiền về ngân hàng'
      when 'game' then 'Nạp trực tiếp vào ' || p_game_platform
      else 'Rút thẻ cào ' || p_card_brand
    end);

  perform public.log_audit('create_withdrawal','withdrawal', v_id,
    jsonb_build_object('amount_vnd', p_amount_vnd, 'method', p_method));
  return v_id;
end $$;

-- ── RPC admin giao thẻ cào: bắt buộc có mã mới được đánh dấu hoàn thành ──
create or replace function public.admin_deliver_card(
  p_id uuid, p_code text, p_serial text default '', p_note text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.withdrawal_requests%rowtype;
begin
  perform public.require_admin();
  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu rút tiền.'; end if;
  if w.method <> 'card' then
    raise exception 'Yêu cầu này không phải rút thẻ cào.';
  end if;
  if w.user_id = auth.uid() then
    raise exception 'Không thể tự duyệt yêu cầu của chính mình.';
  end if;
  if w.status not in ('pending','processing') then
    raise exception 'Yêu cầu này đã ở trạng thái % — không xử lý lại được.', w.status;
  end if;
  if char_length(trim(coalesce(p_code,''))) < 6 then
    raise exception 'Mã thẻ phải có ít nhất 6 ký tự.';
  end if;

  update public.withdrawal_requests
     set status = 'approved', card_code = trim(p_code),
         card_serial = left(trim(coalesce(p_serial,'')),40),
         admin_note = nullif(trim(p_note),''), reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id;

  perform public.log_audit('deliver_card','withdrawal', p_id,
    jsonb_build_object('amount_vnd', w.amount_vnd, 'brand', w.card_brand));
end $$;

-- admin_review_withdrawal KHÔNG được duyệt thẻ cào — phải qua admin_deliver_card
create or replace function public.admin_review_withdrawal(
  p_id uuid, p_status text, p_note text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.withdrawal_requests%rowtype;
begin
  perform public.require_admin();
  if p_status not in ('processing','approved','rejected') then
    raise exception 'Trạng thái không hợp lệ.';
  end if;

  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu rút tiền.'; end if;
  if w.user_id = auth.uid() then
    raise exception 'Không thể tự duyệt yêu cầu rút của chính mình.';
  end if;
  if p_status = 'approved' and w.method = 'card' then
    raise exception 'Yêu cầu thẻ cào phải nhập mã thẻ qua chức năng giao thẻ.';
  end if;
  if w.status not in ('pending','processing') then
    raise exception 'Yêu cầu này đã ở trạng thái % — không xử lý lại được.', w.status;
  end if;

  if p_status = 'rejected' then
    if char_length(trim(coalesce(p_note,''))) < 3 then
      raise exception 'Phải nêu lý do từ chối (tối thiểu 3 ký tự).';
    end if;
    perform 1 from public.profiles where id = w.user_id for update;
    update public.withdrawal_requests
       set status = 'rejected', admin_note = trim(p_note),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_id;
    insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
    values (w.user_id, w.amount_vnd, 'refund', p_id, 'Hoàn tiền do yêu cầu bị từ chối');
    perform public.log_audit('reject_withdrawal','withdrawal',p_id,
      jsonb_build_object('amount_vnd', w.amount_vnd, 'note', p_note));
  else
    update public.withdrawal_requests
       set status = p_status, admin_note = nullif(trim(p_note),''),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_id;
    perform public.log_audit(p_status || '_withdrawal','withdrawal',p_id,
      jsonb_build_object('amount_vnd', w.amount_vnd));
  end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_deliver_card')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon',    f.sig);
  end loop;
end $$;

grant execute on function public.create_withdrawal_request(text,bigint,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.admin_deliver_card(uuid,text,text,text) to authenticated;

-- ============================================================================
--  12. ẨN NHIỆM VỤ
--
--  Trước đây chỉ có một đường gỡ nhiệm vụ khỏi danh sách là XOÁ HẲN, mà hàm
--  đó lại từ chối xoá khi nhiệm vụ đã có người nhận — tức là nhiệm vụ đã
--  hoàn thành thì không gỡ được, lại còn còn nằm trên bảng tin.
--
--  Nay tách hai việc:
--    * ẨN (archived_at) — gỡ khỏi bảng tin, GIỮ NGUYÊN toàn bộ lịch sử
--      và dấu vết tiền. Đây là đường đúng cho nhiệm vụ đã có người làm.
--    * XOÁ — chỉ dành cho nhiệm vụ chưa ai nhận, không có dữ liệu để mất.
-- ============================================================================

alter table public.tasks add column if not exists archived_at timestamptz;

create index if not exists tasks_board_idx
  on public.tasks(status, archived_at, created_at desc);

-- Bảng tin: CHỈ nhiệm vụ còn nhận được.
-- Lọc ở đây chứ không ở JavaScript — cùng nguyên tắc với phần tiền:
-- frontend là thứ công khai, không được là nơi ra quyết định.
drop view if exists public.v_tasks;
create view public.v_tasks as
select
  t.id, t.title, t.description, t.task_type, t.price_vnd,
  t.quantity, t.taken_count,
  greatest(t.quantity - t.taken_count, 0)::int as remaining,
  'open'::text as status,
  t.priority, t.deadline_at, t.created_by, t.created_at
from public.tasks t
where t.archived_at is null and t.status = 'open' and t.taken_count < t.quantity;

-- Nhiệm vụ đã đủ người nhận, chưa ẩn — chỉ lấy khi người dùng bật xem.
drop view if exists public.v_tasks_closed;
create view public.v_tasks_closed as
select
  t.id, t.title, t.description, t.task_type, t.price_vnd,
  t.quantity, t.taken_count,
  0::int as remaining,
  'closed'::text as status,
  t.priority, t.deadline_at, t.created_by, t.created_at
from public.tasks t
where t.archived_at is null and (t.status = 'closed' or t.taken_count >= t.quantity);

-- Nhiệm vụ đã ẩn vẫn phải thấy được ở trang quản trị và trong lượt của người nhận
drop view if exists public.v_tasks_admin;
create view public.v_tasks_admin as
select
  t.id, t.title, t.description, t.task_type, t.price_vnd,
  t.quantity, t.taken_count,
  greatest(t.quantity - t.taken_count, 0)::int as remaining,
  case when t.taken_count >= t.quantity then 'closed'::text else t.status end as status,
  t.priority, t.deadline_at, t.created_by, t.created_at, t.archived_at,
  -- đã có người nhận thì không xoá hẳn được; giao diện dựa vào cột này để
  -- chỉ hiện nút "Xoá" khi thật sự xoá được
  (select count(*) from public.submissions s where s.task_id = t.id)::int as sub_count
from public.tasks t;

-- Không ai nhận được nhiệm vụ đã ẩn
create or replace function public.claim_task(p_task_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t          public.tasks%rowtype;
  v_sub      uuid;
  v_held     int;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;

  select count(*) into v_held
    from public.submissions
   where worker_id = auth.uid()
     and status in ('in_progress','submitted','rejected');

  if v_held >= public.max_held_slots() then
    raise exception 'Bạn đang giữ tối đa % nhiệm vụ. Hãy gửi thành quả hoặc chờ duyệt trước khi nhận thêm.',
      public.max_held_slots();
  end if;

  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  if t.archived_at is not null then
    raise exception 'Nhiệm vụ này đã được gỡ khỏi danh sách.';
  end if;
  if t.status <> 'open' then
    raise exception 'Nhiệm vụ này đã đóng, không nhận được nữa.';
  end if;
  if t.taken_count >= t.quantity then
    raise exception 'Nhiệm vụ đã hết lượt.';
  end if;
  if t.created_by = auth.uid() then
    raise exception 'Bạn không thể nhận nhiệm vụ do chính mình tạo.';
  end if;
  if t.deadline_at is not null and t.deadline_at < now() then
    raise exception 'Nhiệm vụ đã quá hạn.';
  end if;

  insert into public.submissions (task_id, worker_id, price_vnd)
  values (t.id, auth.uid(), t.price_vnd)
  returning id into v_sub;

  update public.tasks
     set taken_count = taken_count + 1,
         status = case when taken_count + 1 >= quantity then 'closed' else 'open' end
   where id = t.id;

  perform public.log_audit('claim_task','submission', v_sub,
    jsonb_build_object('task_id', t.id, 'price_vnd', t.price_vnd));

  return v_sub;
end $$;

-- ẨN / BỎ ẨN — luôn làm được, kể cả khi nhiệm vụ đã có người nhận
create or replace function public.admin_archive_task(p_task_id uuid, p_archive boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  update public.tasks
     set archived_at = case when p_archive then now() else null end
   where id = p_task_id;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  perform public.log_audit(
    case when p_archive then 'archive_task' else 'unarchive_task' end,
    'task', p_task_id);
end $$;

-- XOÁ — chỉ khi chưa ai nhận. Lý do: giữ được dấu vết người nào được trả
-- tiền vì nhiệm vụ nào. Cần dọn thì dùng ẨN.
create or replace function public.admin_delete_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.require_admin();
  select count(*) into n from public.submissions where task_id = p_task_id;
  if n > 0 then
    raise exception 'Nhiệm vụ đã có % lượt được nhận nên không xoá hẳn được. Hãy dùng nút “Ẩn” để gỡ khỏi danh sách — lịch sử vẫn được giữ nguyên.', n;
  end if;
  delete from public.tasks where id = p_task_id;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  perform public.log_audit('delete_task','task', p_task_id);
end $$;

drop view if exists public.v_admin_stats;
create view public.v_admin_stats as
select
  (select count(*) from public.tasks where status = 'open' and archived_at is null)::int as tasks_open,
  (select count(*) from public.tasks where archived_at is not null)::int as tasks_archived,
  (select count(*) from public.submissions where status = 'submitted')::int as waiting_review,
  (select count(*) from public.submissions where status = 'in_progress')::int as in_progress,
  (select count(*) from public.profiles where role = 'worker')::int as workers,
  (select coalesce(sum(amount_vnd),0) from public.transactions
     where type = 'task_reward' and created_at > now() - interval '30 days')::bigint as paid_30d,
  (select coalesce(sum(amount_vnd),0) from public.transactions
     where type = 'task_reward' and created_at > now() - interval '1 day')::bigint as paid_24h;

revoke all on public.v_tasks_admin, public.v_tasks_closed from anon, authenticated;
grant select on public.v_tasks_admin, public.v_tasks_closed to authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_archive_task'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon',    f.sig);
  end loop;
end $$;

grant execute on function public.admin_archive_task(uuid, boolean) to authenticated;
