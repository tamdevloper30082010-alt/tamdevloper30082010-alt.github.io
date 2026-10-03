-- ============================================================================
--  LOẠI NHIỆM VỤ + ẢNH THÀNH QUẢ  —  vá nốt lần migrate trước
--
--  Bối cảnh: lần migrate trước đã thêm `tasks.task_type`,
--  `submissions.evidence_path` và bucket `task-evidence`, nhưng dừng ở giữa:
--    • `submit_result` vẫn BẮT BUỘC result_url (3–1000 ký tự) → không nộp
--      được nhiệm vụ chỉ có ảnh.
--    • `sub_result_required` vẫn đòi result_url NOT NULL khi submitted/approved.
--    • `tasks.target_url` còn NOT NULL + check 8..2000 ký tự → nhiệm vụ loại
--      "khác" không thể bỏ trống link.
--    • KHÔNG có policy DELETE nào trên storage → ảnh không bao giờ xoá được,
--      và người nhận không thay được ảnh cũ khi bị từ chối.
--    • `admin_review_submission` trả void → không ai biết đường dẫn ảnh cần
--      dọn sau khi duyệt.
--
--  File này idempotent: chạy lại bao nhiêu lần cũng cho cùng kết quả.
--  Chạy bằng:  SUPABASE_ACCESS_TOKEN=… SUPABASE_REF=… ./scripts/db.sh \
--                supabase/migration-task-type-evidence.sql
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. tasks: link có thể vắng mặt
-- ────────────────────────────────────────────────────────────────────────────

alter table public.tasks alter column target_url drop not null;

-- Cột `platform` cũ không còn ai đọc. GIỮ LẠI (không drop) để không mất dữ
-- liệu và để quay lui được nếu cần — frontend và các view đã bỏ dùng nó.
comment on column public.tasks.platform is
  'Cũ — đã thay bằng task_type. Giữ lại để không mất dữ liệu, không dùng nữa.';

-- ══ Vá dữ liệu TRƯỚC, rồi mới ép constraint ══
-- Thêm constraint khi còn dữ liệu vi phạm sẽ fail ngay lập tức.

-- Mọi nhiệm vụ tạo từ trước đều là nhiệm vụ vượt link.
update public.tasks set task_type = 'link' where task_type is null;

-- Nhiệm vụ loại "khác" bắt buộc phải có mô tả — nếu không thì người nhận
-- không biết phải làm gì, còn admin thì không có gì để đối chiếu với ảnh.
update public.tasks
   set description = 'Xem mô tả chi tiết bên trong nhiệm vụ.'
 where task_type = 'other'
   and char_length(trim(coalesce(description,''))) < 10;

-- Loại "khác" thì không giữ link cũ.
update public.tasks set target_url = null where task_type = 'other';

-- Check cũ ép target_url dài 8..2000 ký tự → không nạp được khi cột đã nullable.
alter table public.tasks drop constraint if exists tasks_target_url_check;
alter table public.tasks
  add constraint tasks_target_url_check
  check (target_url is null or char_length(trim(target_url)) between 8 and 2000);

-- Ràng buộc thật sự: loại nhiệm vụ quyết định có link hay không.
--   link  → bắt buộc link http(s)
--   other → không được có link (người nhận nộp ảnh)
alter table public.tasks drop constraint if exists tasks_type_target_check;
alter table public.tasks
  add constraint tasks_type_target_check
  check (
    (task_type = 'link'  and target_url ~* '^https?://')
    or
    (task_type = 'other' and target_url is null)
  );

alter table public.tasks drop constraint if exists tasks_type_desc_check;
alter table public.tasks
  add constraint tasks_type_desc_check
  check (task_type <> 'other' or char_length(trim(description)) >= 10);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. submissions: ảnh thay được link
-- ────────────────────────────────────────────────────────────────────────────

alter table public.submissions add column if not exists evidence_path text;

-- 'approved' CỐ TÝ không nằm trong danh sách này: duyệt xong thì ảnh bị xoá
-- và link cũng không giữ nữa, nên hàng đã duyệt được phép trống. Nếu ép
-- approved cũng phải có thành quả thì mọi lượt nộp ảnh sẽ không duyệt được.
alter table public.submissions drop constraint if exists sub_result_required;
alter table public.submissions
  add constraint sub_result_required
  check (
    status not in ('submitted','rejected')
    or result_url is not null
    or evidence_path is not null
  );

-- Link và ảnh là hai cách nộp khác nhau, không dùng cùng lúc.
alter table public.submissions drop constraint if exists sub_one_proof;
alter table public.submissions
  add constraint sub_one_proof
  check (not (result_url is not null and evidence_path is not null));

-- Ảnh nằm trong thư mục của chính người gửi, đuôi ảnh hợp lệ, không quá dài.
alter table public.submissions drop constraint if exists sub_evidence_path_check;
alter table public.submissions
  add constraint sub_evidence_path_check
  check (
    evidence_path is null
    or (char_length(evidence_path) <= 300
        and evidence_path ~ '^[A-Za-z0-9_./-]+$'
        and evidence_path ~* '\.(jpg|jpeg|png|webp)$')
  );

-- sub_result_uniq (1 link kết quả chỉ dùng 1 lần) GIỮ NGUYÊN: còn áp dụng
-- đúng cho nhiệm vụ vượt link. Không đụng vào index đang chạy tốt.

-- Chống dùng lại ảnh cũ: mỗi lượt một đường dẫn ảnh duy nhất.
create unique index if not exists sub_evidence_uniq
  on public.submissions(evidence_path)
  where evidence_path is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. NỘP THÀNH QUẢ — link hoặc ảnh, tuỳ loại nhiệm vụ
--    Đổi thân hàm nên phải drop trước (Postgres không cho đổi kiểu trả về
--    của hàm đang tồn tại).
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.submit_result(uuid, text, text, text);

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

-- Trả về đường dẫn ảnh cũ (nếu có) để client xoá — ảnh bị từ chối rồi nộp
-- lại sẽ không để lại rác trong bucket.
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
-- 4. DUYỆT — xoá ảnh sau khi duyệt
--    Postgres không xoá được file trong Storage (đó là dịch vụ riêng, cần
--    service key mà frontend không được có). Nên hàm này TRẢ LẠI đường dẫn
--    đã xoá khỏi database, client dùng đường dẫn đó để xoá file.
--    Đường dẫn cũng được ghi vào audit_log nên nếu client chết giữa chừng
--    thì admin_evidence_orphans() quét lại được.
-- ────────────────────────────────────────────────────────────────────────────

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

-- Thu hồi lượt cũng phải trả đường dẫn ảnh để client dọn.
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

-- Quét ảnh còn sót: mọi lần duyệt đều ghi evidence_path vào audit_log.
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

-- ────────────────────────────────────────────────────────────────────────────
-- 5. SỬA / TẠO NHIỆM VỤ — chặn việc nhét link vào nhiệm vụ loại "khác"
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.admin_create_task(text,text,text,text,bigint,int,timestamptz,text);

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
    if char_length(trim(coalesce(p_description,''))) < 10 then
      raise exception 'Nhiệm vụ khác bắt buộc phải có mô tả công việc (tối thiểu 10 ký tự).';
    end if;
    -- Không bỏ âm thầm: admin còn sót link trong ô nhập thì phải biết ngay,
    -- chứ không phải tạo xong mới thấy link biến mất.
    if trim(coalesce(p_target_url,'')) <> '' then
      raise exception 'Nhiệm vụ khác không dùng link. Bỏ trống ô link, hoặc chọn loại “Vượt link”.';
    end if;
    v_url := null;
  end if;

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

drop function if exists public.admin_update_task(uuid,text,text,text,text,bigint,int,timestamptz,text,text);

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

-- ────────────────────────────────────────────────────────────────────────────
-- 6. BUCKET ẢNH + QUYỀN
--    Không có policy DELETE là lỗi chết người: ảnh không bao giờ xoá được
--    và người nhận không thay được ảnh cũ khi bị từ chối.
-- ────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-evidence', 'task-evidence', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
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

-- Xem ảnh: chủ ảnh hoặc admin. Không có policy UPDATE ⇒ ảnh bất biến sau khi
-- nộp, không ai lén thay ảnh rồi mới gửi duyệt.
drop policy if exists evidence_read on storage.objects;
create policy evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-evidence'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Xoá: chủ ảnh (để thay ảnh khi bị từ chối, hoặc dọn khi bỏ lượt) và admin
-- (để dọn ảnh tồn sau khi duyệt).
drop policy if exists evidence_delete on storage.objects;
create policy evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-evidence'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6b. SỐ DƯ ÂM — CẤM RÚT CHO TỚI KHI BÙ VỀ 0
--
--  Admin có thể trừ số dư xuống dưới 0 (đòi nợ khi người dùng hoàn sai,
--  dùng thẻ đã tiêu…). Từ đó người dùng KHÔNG rút được cho tới khi kiếm
--  nhiệm vụ bù về 0. Sổ cái không đổi: vẫn chỉ là cột adjustment âm.
--
--  Lưu ý khi sửa hàm này: PHẢI GIỮ NGUYÊN phần `default ''` cho 7 tham số
--  sau p_amount_vnd. Bỏ default là PostgREST không còn tra được hàm khi
--  client gọi thiếu tham số → mọi yêu cầu rút tiền trả về PGRST202.
-- ────────────────────────────────────────────────────────────────────────────

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

revoke all on function public.create_withdrawal_request(text,bigint,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_withdrawal_request(text,bigint,text,text,text,text,text,text,text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. VIEW + QUYỀN GỌI
-- ────────────────────────────────────────────────────────────────────────────

-- v_submissions phải có evidence_path + task_type cho giao diện.
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

-- get_target_url phải trả null cho nhiệm vụ không có link, thay vì lỗi.
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
  return v_url;   -- null với nhiệm vụ loại "khác", đúng như thiết kế
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'submit_result','cancel_my_submission','admin_review_submission',
      'admin_release_slot','admin_create_task','admin_update_task',
      'admin_evidence_orphans'
    )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon',    f.sig);
  end loop;
end $$;

grant execute on function public.submit_result(uuid,text,text,text) to authenticated;
grant execute on function public.cancel_my_submission(uuid)         to authenticated;
grant execute on function public.admin_review_submission(uuid,boolean,text) to authenticated;
grant execute on function public.admin_release_slot(uuid,text)      to authenticated;
grant execute on function public.admin_create_task(text,text,text,text,bigint,int,timestamptz,text) to authenticated;
grant execute on function public.admin_update_task(uuid,text,text,text,text,bigint,int,timestamptz,text,text) to authenticated;
grant execute on function public.admin_evidence_orphans()            to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. CHỐT HAI TRƯỜNG HỢP SỐ
--    Dưới đây KHÔNG được chạy tự động — xem README.
-- ────────────────────────────────────────────────────────────────────────────
--  Ảnh tồn trong bucket (nếu có từ lần thử trước) — xoá thủ công:
--    select storage.delete_object('task-evidence', name) from storage.objects
--     where bucket_id = 'task-evidence';

-- Hàm đổi chữ ký ⇒ PostgREST vẫn giữ cache cũ và trả PGRST202 cho mọi lời
-- gọi RPC. Bắn NOTIFY để nó nạp lại ngay (Supabase cũng tự reload theo chu kỳ,
-- nhưng đợi chu kỳ thì trang rút tiền hỏng tới lúc đó).
notify pgrst, 'reload schema';
