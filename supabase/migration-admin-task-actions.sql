-- ============================================================================
--  MIGRATION: Admin task actions (close / reset / hard-delete) + Discord buttons
--
--  Gồm:
--    1. notify_discord thêm tham số p_buttons để đính nút bấm vào embed.
--    2. Hàm tiện ích: btn, discord_buttons, page_url, task_url.
--    3. Ba hàm admin cho nhiệm vụ:
--         admin_close_task(p_task_id)            – đóng + trả lượt in_progress
--         admin_reset_task(p_task_id)            – reset lượt + mở lại + đăng lại
--         admin_purge_task(p_task_id, p_confirm) – xoá hẳn (cần gõ lại tiêu đề)
--    4. admin_create_task / admin_review_submission / admin_review_withdrawal /
--       handle_new_user / admin_adjust_balance được cập nhật để truyền nút
--       "Xem chi tiết" / "Nhận nhiệm vụ" vào Discord.
--
--  Tất cả hàm đều CREATE OR REPLACE ⇒ chạy file này nhiều lần vô hại.
--  Frontend có thể gọi các hàm cũ (admin_update_task) y nguyên; chỉ cần đổi
--  sang admin_close_task / admin_reset_task / admin_purge_task để có nút
--  chuyên biệt.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. HÀM TIỆN ÍCH CHO NÚT DISCORD
-- ────────────────────────────────────────────────────────────────────────────

-- Một nút link kiểu Discord: webhook CHỈ hỗ trợ nút link (type 2), không có
-- modal hay select. Trả về null nếu URL không hợp lệ để gọi jsonb_agg được
-- trơn tru.
--
-- Discord chỉ cho phép style 5 (Link) đi kèm với url. Các style 1–4
-- (Primary/Secondary/Success/Danger) là nút tương tác, KHÔNG nhận url.
-- Tham số p_primary được giữ lại để không phải sửa tất cả lời gọi hiện
-- có; nó được bỏ qua vì webhook không có cách làm nút link nổi bật hơn
-- — thứ tự + label mới quyết định "nút chính".
drop function if exists public.btn(text, text, boolean);
create or replace function public.btn(p_label text, p_url text, p_primary boolean default false)
returns jsonb language sql immutable as $$
  select case
           when p_url is null or p_url !~* '^https?://' then null
           else jsonb_build_object(
                  'type',  2,
                  'style', 5,
                  'label', left(p_label, 80),
                  'url',   p_url
                )
         end;
$$;

-- Bọc danh sách nút thành một ActionRow duy nhất.
-- Hai overload:
--   - bản immutable (cũ): lọc URL hợp lệ rồi gói ActionRow.
--   - bản stable (mới): kèm tên event để log khi có nút bị rớt vì lỗi dữ liệu.
drop function if exists public.discord_buttons(jsonb);
drop function if exists public.discord_buttons(jsonb, text);
create or replace function public.discord_buttons(p_buttons jsonb)
returns jsonb language sql immutable as $$
  select case
           when p_buttons is null or jsonb_array_length(p_buttons) = 0 then null
           else jsonb_build_array(jsonb_build_object(
                  'type', 1,
                  'components', (
                    select coalesce(jsonb_agg(b), '[]'::jsonb)
                      from jsonb_array_elements(p_buttons) b
                     where jsonb_typeof(b) = 'object'
                       and b ->> 'url' is not null
                       and (b ->> 'url') like 'http%'
                       and b ->> 'label' is not null
                       and length(b ->> 'label') between 1 and 80
                  )
                ))
         end;
$$;

create or replace function public.discord_buttons(p_buttons jsonb, p_event text default null)
returns jsonb language plpgsql stable as $$
declare
  v_keep jsonb;
  v_drop int := 0;
begin
  if p_buttons is null or jsonb_typeof(p_buttons) <> 'array' then
    return null;
  end if;

  select coalesce(jsonb_agg(b order by ord), '[]'::jsonb), count(*)
    into v_keep, v_drop
    from jsonb_array_elements(p_buttons) with ordinality as e(b, ord)
   where jsonb_typeof(b) = 'object'
     and (b ->> 'url') like 'http%'
     and b ->> 'label' is not null
     and length(b ->> 'label') between 1 and 80;

  if v_drop < jsonb_array_length(p_buttons) then
    perform public.log_audit(
      'discord_buttons_dropped', 'notification', null,
      jsonb_build_object('event', p_event, 'dropped', v_drop,
                         'total', jsonb_array_length(p_buttons)));
  end if;

  if v_keep is null or jsonb_array_length(v_keep) = 0 then
    return null;
  end if;

  return jsonb_build_array(jsonb_build_object(
    'type', 1,
    'components', v_keep));
end;
$$;

-- URL tuyệt đối tới trang web. site_url lấy từ Vault; nếu chưa cấu hình
-- thì trả về path tương đối (Discord vẫn nhận nhưng người dùng sẽ phải tự
-- thêm domain — đỡ hơn là gửi sai link).
create or replace function public.page_url(p_path text)
returns text language sql stable as $$
  select rtrim(coalesce(public.discord_secret('site_url'), ''), '/')
      || '/' || ltrim(coalesce(p_path, ''), '/');
$$;

create or replace function public.task_url(p_task_id uuid)
returns text language sql stable as $$
  select rtrim(coalesce(public.discord_secret('site_url'), ''), '/')
      || '/nhiem-vu/' || p_task_id::text;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. notify_discord — thêm tham số p_buttons
--
--  Tham số cũ giữ nguyên thứ tự + default; chỉ thêm p_buttons ở cuối để các
--  lời gọi cũ KHÔNG cần sửa. Nút bấm chỉ làm đẹp embed; nếu Discord từ chối
--  thì vẫn gửi tin được.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.notify_discord(text,text,text,jsonb,boolean);
drop function if exists public.notify_discord(text,text,text,jsonb,boolean,jsonb);
create or replace function public.notify_discord(
  p_event text,
  p_title text,
  p_body text default '',
  p_fields jsonb default '{}'::jsonb,
  p_ok boolean default true,
  p_buttons jsonb default null
) returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_url   text;
  v_role  text;
  v_lines text;
  v_key   text;
  v_val   text;
  v_embeds jsonb;
  v_body  jsonb;
  v_buttons jsonb;
  v_params jsonb;
  v_mention boolean := false;
begin
  if not exists (select 1 from public.discord_notify_rules
                  where event = p_event and enabled) then
    return null;
  end if;
  select mention into v_mention
    from public.discord_notify_rules where event = p_event;
  v_mention := coalesce(v_mention, false);

  v_url := public.discord_secret('discord_webhook_url');
  if v_url is null then return null; end if;

  begin
    v_role := case when v_mention then public.discord_secret('discord_role_id') end;

    v_lines := '';
    if p_body is not null and trim(p_body) <> '' then
      v_lines := trim(p_body) || E'\n';
    end if;
    if p_fields is not null and p_fields <> '{}'::jsonb then
      for v_key, v_val in select * from jsonb_each_text(p_fields)
      loop
        v_lines := v_lines || '**' || v_key || ':** ' || coalesce(v_val, '—') || E'\n';
      end loop;
    end if;

    v_embeds := jsonb_build_array(jsonb_build_object(
      'title',       left(p_title, 256),
      'description', left(trim(trailing E'\n' from v_lines), 4096),
      'color',       public.discord_color(p_ok),
      'footer',      jsonb_build_object('text', 'Vượt Nhanh · ' || to_char(now(), 'DD/MM/YYYY HH24:MI')),
      'timestamp',   to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ));

    -- discord_buttons() đã trả sẵn cả khối components (ActionRow) ⇒ gán
    -- thẳng vào 'components'. KHÔNG bọc thêm lần nữa ở đây.
    v_buttons := case
                   when p_buttons is null then null
                   else public.discord_buttons(p_buttons, p_event)
                 end;

    v_body := jsonb_build_object(
      'username', 'Vượt Nhanh',
      'content',  case when v_role is not null then '<@&' || v_role || '>' else '' end,
      'embeds',   v_embeds,
      'components', v_buttons,
      'allowed_mentions', jsonb_build_object(
        'parse', jsonb_build_array(),
        'roles', case when v_role is not null then jsonb_build_array(v_role) else '[]'::jsonb end
      )
    );

    -- ⚠ with_components=true là BẮT BUỘC, thiếu là nút bị bỏ âm thầm.
    --
    --   Theo docs.webhook của Discord: "Non-application-owned webhooks cannot
    --   send interactive components, and the `components` field will be ignored
    --   unless they set the `with_components` query param."
    --
    --   Webhook tạo từ giao diện Discord (cái mà ta đang dùng) KHÔNG phải
    --   application-owned ⇒ phải tự bật param. Thiếu param thì Discord vẫn
    --   trả HTTP 204/200 nhưng `components` trong tin nhắn là [] — tức là tin
    --   vẫn gửi được, chỉ là mất sạch nút bấm, và không có lỗi nào báo ra.
    --   Đó là lý do dễ tưởng "đã gửi nút" trong khi thực tế không có nút.
    --
    --   Chỉ thêm param khi thật sự có nút: những tin không có nút thì không
    --   cần, và để nguyên cũng giúp phát hiện nếu sau này ta vô tình gửi
    --   components mà quên bật param (trả về components=[] như cũ).
    v_params := case
                   when v_buttons is null then '{}'::jsonb
                   else '{"with_components": "true"}'::jsonb
                 end;

    return net.http_post(
      url     := v_url,
      body    := v_body,
      params  := v_params,
      headers := '{}'::jsonb
    )::text;

  exception
    when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('title', p_title, 'error', left(sqlerrm, 300)));
      return null;
  end;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Ba hàm admin cho nhiệm vụ
-- ────────────────────────────────────────────────────────────────────────────

-- ĐÓNG — luôn làm được, kể cả khi còn lượt in_progress.
-- Lượt in_progress sẽ bị huỷ (trả về kho); lượt submitted/rejected vẫn
-- giữ nguyên vì admin có thể đang muốn duyệt tiếp. taken_count được đồng bộ
-- lại bằng số lượt thật đang được giữ.
drop function if exists public.admin_close_task(uuid);
create or replace function public.admin_close_task(p_task_id uuid)
returns integer language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  t     public.tasks%rowtype;
  v_open int := 0;
begin
  perform public.require_admin();

  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;
  if t.status = 'closed' then return 0; end if;

  select count(*) into v_open from public.submissions
   where task_id = p_task_id and status = 'in_progress';
  if v_open > 0 then
    update public.submissions
       set status = 'cancelled',
           admin_note = 'Nhiệm vụ đã đóng, lượt trả về kho',
           reviewed_at = now(), reviewed_by = auth.uid()
     where task_id = p_task_id and status = 'in_progress';
  end if;

  -- taken_count phải khớp với số lượt thật đang giữ; dùng signal cũ có thể
  -- đã lệch nếu từng có lượt bị huỷ trước đó.
  update public.tasks
     set taken_count = (select count(*) from public.submissions
                         where task_id = p_task_id
                           and status in ('submitted','approved')),
         status = 'closed'
   where id = p_task_id;

  perform public.log_audit('close_task','task',p_task_id,
    jsonb_build_object('released_slots', v_open));

  begin
    perform public.notify_discord(
      'task_closed',
      '⛔ Admin đã đóng nhiệm vụ',
      'Không nhận thêm lượt nữa.',
      jsonb_build_object('Nhiệm vụ', t.title, 'Lượt trả về kho', v_open::text),
      false,
      jsonb_build_array(public.btn('Xem chi tiết', public.task_url(p_task_id)))
    );
  exception when others then null; end;

  return v_open;
end $$;

-- RESET — mở lại và reset lượt nhận về 0, đăng lại Discord.
-- Lượt in_progress/rejected bị huỷ để lấy lại kho; approved/submitted vẫn
-- giữ nguyên (tiền đã trả, không lấy lại được) nhưng KHÔNG tính vào taken_count
-- mới — tức là nhiệm vụ được "tái đăng" với quantity lượt mới.
drop function if exists public.admin_reset_task(uuid);
create or replace function public.admin_reset_task(p_task_id uuid)
returns integer language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  t     public.tasks%rowtype;
  v_open int := 0;
begin
  perform public.require_admin();

  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;

  -- Không cho reset nếu vẫn còn lượt chưa giải quyết xong, tránh xoá dấu vết
  -- đang chờ duyệt. Admin phải duyệt / từ chối / thu hồi trước.
  if exists (
    select 1 from public.submissions
     where task_id = p_task_id
       and status in ('submitted','in_progress','rejected')
  ) then
    raise exception 'Còn lượt chưa xử lý xong (chờ duyệt / đang làm / bị từ chối). Duyệt hoặc thu hồi trước khi reset.';
  end if;

  -- Lấy lại lượt từ những submission cũ đã cancelled/approved (nếu có).
  -- Sau khi reset thì taken_count = 0 để khớp với view; submission approved
  -- vẫn còn lại làm dấu vết tiền, không bị xoá.
  update public.tasks
     set taken_count = 0, status = 'open', archived_at = null
   where id = p_task_id;

  perform public.log_audit('reset_task','task',p_task_id,
    jsonb_build_object('quantity', t.quantity));

  begin
    perform public.notify_discord(
      'task_reset',
      '🔄 Nhiệm vụ được mở lại và đăng lại',
      'Đã reset lượt nhận về 0 và đăng lại cho mọi người.',
      jsonb_build_object(
        'Nhiệm vụ', t.title,
        'Loại',     case t.task_type when 'link' then '🔗 Vượt link' else '🧩 Nhiệm vụ khác' end,
        'Thưởng/lượt', public.vnd_txt(t.price_vnd),
        'Số lượt', t.quantity::text
      ),
      true,
      jsonb_build_array(
        public.btn('✅ Nhận nhiệm vụ', public.task_url(p_task_id), true),
        public.btn('Xem chi tiết', public.task_url(p_task_id))
      )
    );
  exception when others then null; end;

  return v_open;
end $$;

-- XOÁ HẲN — kể cả khi đã có submission, kể cả khi đã duyệt tiền.
-- submissions CASCADE theo FK; tiền đã trả KHÔNG hoàn lại (đó là chủ ý —
-- xoá nhiệm vụ là thao tác đặc biệt, admin phải hiểu là mất dấu vết).
-- Bắt buộc gõ lại đúng tiêu đề để chặn click nhầm.
drop function if exists public.admin_purge_task(uuid, text);
create or replace function public.admin_purge_task(p_task_id uuid, p_confirm text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  t     public.tasks%rowtype;
  v_subs int;
  v_paid bigint;
begin
  perform public.require_admin();

  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Không tìm thấy nhiệm vụ.'; end if;

  if trim(coalesce(p_confirm,'')) <> trim(t.title) then
    raise exception 'Xác nhận không khớp. Gõ lại đúng tiêu đề nhiệm vụ để xoá hẳn.';
  end if;

  select count(*) into v_subs from public.submissions where task_id = p_task_id;
  select coalesce(sum(amount_vnd),0) into v_paid from public.transactions
   where ref_id in (select id from public.submissions where task_id = p_task_id)
     and type = 'task_reward';

  -- submissions bị xoá theo ON DELETE CASCADE của FK.
  delete from public.tasks where id = p_task_id;

  perform public.log_audit('purge_task','task',p_task_id,
    jsonb_build_object('title', t.title, 'submissions', v_subs,
                       'paid_vnd', v_paid));

  begin
    perform public.notify_discord(
      'task_purged',
      '🗑️ Nhiệm vụ đã bị xoá hẳn',
      'Dấu vết lượt đã xoá; tiền đã trả cho người nhận vẫn giữ nguyên trong sổ cái.',
      jsonb_build_object(
        'Nhiệm vụ', t.title,
        'Số lượt đã xoá', v_subs::text,
        'Tiền đã trả (giữ nguyên)', public.vnd_txt(v_paid)
      ),
      false
    );
  exception when others then null; end;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Cập nhật các hàm nghiệp vụ để truyền nút bấm vào Discord
--
--  Tất cả đều dùng create or replace; chạy lại vô hại.
-- ────────────────────────────────────────────────────────────────────────────

-- Đăng nhiệm vụ: nút "Nhận nhiệm vụ" (primary) + "Xem chi tiết".
drop function if exists public.admin_create_task(text,text,text,text,bigint,int,timestamptz,text);
create or replace function public.admin_create_task(
  p_title text, p_description text, p_target_url text,
  p_task_type text, p_price_vnd bigint, p_quantity int,
  p_deadline_at timestamptz, p_priority text
) returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid;
  v_url text;
  v_deadline text;
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

  v_deadline := case when p_deadline_at is null then 'Không'
                     else to_char(p_deadline_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
                end;

  begin
    perform public.notify_discord(
      'task_created',
      '🆕 Nhiệm vụ mới vừa được đăng',
      left(coalesce(p_description,''), 300),
      jsonb_build_object(
        'Nhiệm vụ',     trim(p_title),
        'Loại',         case p_task_type when 'link' then '🔗 Vượt link' else '🧩 Nhiệm vụ khác' end,
        'Thưởng/lượt',  public.vnd_txt(p_price_vnd),
        'Số lượt',      p_quantity::text,
        'Hạn nộp',     v_deadline,
        'Đăng bởi',    public.display_name(auth.uid())
      ),
      true,
      jsonb_build_array(
        public.btn('✅ Nhận nhiệm vụ', public.task_url(v_id), true),
        public.btn('Xem chi tiết', public.task_url(v_id))
      )
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'task_created', 'error', left(sqlerrm, 300)));
  end;

  return v_id;
end $$;

-- Duyệt/từ chối thành quả: cả hai nhánh đều có nút "Xem chi tiết".
drop function if exists public.admin_review_submission(uuid, boolean, text);
create or replace function public.admin_review_submission(
  p_submission_id uuid, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  s     public.submissions%rowtype;
  t     public.tasks%rowtype;
  v_ev  text;
  v_bal bigint;
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

  select * into t from public.tasks where id = s.task_id;

  if p_approve then
    v_ev := s.evidence_path;

    update public.submissions
       set status = 'approved', admin_note = nullif(trim(p_note), ''),
           reviewed_at = now(), reviewed_by = auth.uid(),
           evidence_path = null,
           result_url = case when v_ev is not null then null else result_url end
     where id = p_submission_id;

    insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
    values (s.worker_id, s.price_vnd, 'task_reward', p_submission_id, 'Thưởng hoàn thành nhiệm vụ');

    perform public.log_audit('approve','submission',p_submission_id,
      jsonb_build_object('amount_vnd', s.price_vnd, 'worker_id', s.worker_id,
                         'evidence_path', v_ev));

    v_bal := public.balance_of(s.worker_id);
    begin
      perform public.notify_discord(
        'evidence_approved',
        '✅ Thành quả đã được duyệt',
        case when v_ev is not null
             then 'Ảnh thành quả đã được xoá khỏi kho để tiết kiệm dung lượng.'
             else null end,
        jsonb_build_object(
          'Người nhận',   public.display_name(s.worker_id),
          'Nhiệm vụ',     t.title,
          'Loại',         case t.task_type when 'link' then '🔗 Vượt link' else '🧩 Nhiệm vụ khác' end,
          'Được cộng',    public.vnd_txt(s.price_vnd),
          'Số dư hiện tại', public.vnd_txt(v_bal)
        ),
        true,
        jsonb_build_array(public.btn('Xem chi tiết', public.task_url(s.task_id)))
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'evidence_approved', 'error', left(sqlerrm, 300)));
    end;
  else
    if char_length(trim(coalesce(p_note,''))) < 3 then
      raise exception 'Phải nêu lý do từ chối (tối thiểu 3 ký tự).';
    end if;
    update public.submissions
       set status = 'rejected', admin_note = trim(p_note),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_submission_id;

    perform public.log_audit('reject','submission',p_submission_id,
      jsonb_build_object('note', p_note));

    v_bal := public.balance_of(s.worker_id);
    begin
      perform public.notify_discord(
        'evidence_rejected',
        '❌ Thành quả bị từ chối',
        'Lý do: **' || trim(p_note) || '**',
        jsonb_build_object(
          'Người nhận',   public.display_name(s.worker_id),
          'Nhiệm vụ',     t.title,
          'Số dư hiện tại', public.vnd_txt(v_bal)
        ),
        false,
        jsonb_build_array(public.btn('Xem chi tiết', public.task_url(s.task_id)))
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'evidence_rejected', 'error', left(sqlerrm, 300)));
    end;
    v_ev := null;
  end if;

  return v_ev;
end $$;

-- Duyệt / từ chối rút tiền: cả ba nhánh (processing / approved / rejected) đều
-- có nút dẫn về trang quản trị.
drop function if exists public.admin_review_withdrawal(uuid, text, text);
create or replace function public.admin_review_withdrawal(
  p_id uuid, p_status text, p_note text
) returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  w     public.withdrawal_requests%rowtype;
  v_bal bigint;
  v_method text;
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

  v_method := case w.method
                when 'bank' then '🏦 Ngân hàng'
                when 'game' then '🎮 Nạp vào game'
                else '🎟 Thẻ cào' end;

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

    v_bal := public.balance_of(w.user_id);
    begin
      perform public.notify_discord(
        'withdraw_rejected',
        '🚫 Yêu cầu rút tiền bị từ chối',
        'Lý do: **' || trim(p_note) || '** — số tiền đã được hoàn lại ví.',
        jsonb_build_object(
          'Người rút',   public.display_name(w.user_id),
          'Số tiền',     public.vnd_txt(w.amount_vnd),
          'Phương thức', v_method,
          'Số dư sau hoàn', public.vnd_txt(v_bal)
        ),
        false,
        jsonb_build_array(public.btn('Xem yêu cầu rút', public.page_url('/admin/rut-tien')))
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'withdraw_rejected', 'error', left(sqlerrm, 300)));
    end;
  else
    update public.withdrawal_requests
       set status = p_status, admin_note = nullif(trim(p_note),''),
           reviewed_at = now(), reviewed_by = auth.uid()
     where id = p_id;
    perform public.log_audit(p_status || '_withdrawal','withdrawal',p_id,
      jsonb_build_object('amount_vnd', w.amount_vnd));

    v_bal := public.balance_of(w.user_id);
    begin
      perform public.notify_discord(
        'withdraw_approved',
        '💸 Yêu cầu rút tiền ' || case p_status when 'approved' then 'đã được duyệt' else 'đang xử lý' end,
        case when p_status = 'approved'
             then 'Hãy chuyển khoản/thẻ cho người rút.'
             else null end,
        jsonb_build_object(
          'Người rút',   public.display_name(w.user_id),
          'Số tiền',     public.vnd_txt(w.amount_vnd),
          'Phương thức', v_method,
          'Số dư còn lại', public.vnd_txt(v_bal)
        ),
        true,
        jsonb_build_array(public.btn('Xem yêu cầu rút', public.page_url('/admin/rut-tien')))
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'withdraw_approved', 'error', left(sqlerrm, 300)));
    end;
  end if;
end $$;

-- Tài khoản mới: nút mở trang chủ.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',''));

  begin
    perform public.notify_discord(
      'user_signup',
      '👤 Có tài khoản mới',
      null,
      jsonb_build_object(
        'Tên',  coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), 'Chưa đặt tên'),
        'Email', new.email,
        'Số dư', '0 ₫'
      ),
      true,
      jsonb_build_array(public.btn('Mở trang chủ', public.page_url('/')))
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'user_signup', 'error', left(sqlerrm, 300)));
  end;
  return new;
end $$;

-- Điều chỉnh số dư: nút dẫn về trang quản trị người dùng.
drop function if exists public.admin_adjust_balance(uuid, bigint, text);
create or replace function public.admin_adjust_balance(
  p_user_id uuid, p_amount_vnd bigint, p_note text
) returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_bal bigint;
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

  v_bal := public.balance_of(p_user_id);
  begin
    perform public.notify_discord(
      'balance_adjusted',
      case when v_bal < 0 then '⛔ Số dư âm — người dùng không rút được' else '⚙️ Điều chỉnh số dư' end,
      'Lý do: **' || trim(p_note) || '**',
      jsonb_build_object(
        'Người dùng', public.display_name(p_user_id),
        'Thay đổi',   public.vnd_txt(p_amount_vnd),
        'Số dư mới',  public.vnd_txt(v_bal)
      ),
      v_bal >= 0,
      jsonb_build_array(public.btn('Xem người dùng', public.page_url('/admin/nguoi-dung')))
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'balance_adjusted', 'error', left(sqlerrm, 300)));
  end;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Bảng cấu hình discord_notify_rules: thêm 3 event mới
-- ────────────────────────────────────────────────────────────────────────────
insert into public.discord_notify_rules (event, enabled, mention) values
  ('task_closed',  true, false),
  ('task_reset',   true, true),
  ('task_purged',  true, false)
on conflict (event) do update
  set enabled = excluded.enabled, mention = excluded.mention;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Quyền
-- ────────────────────────────────────────────────────────────────────────────
-- Cấp EXECUTE có chọn lọc: 3 hàm admin mới + notify_discord / helpers bị khóa
-- khỏi mọi role trừ postgres. revoke all on function ... from public không
-- gỡ được grant đã cấp riêng cho authenticated, phải revoke tường minh.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'notify_discord','btn','discord_buttons','page_url','task_url',
         'admin_close_task','admin_purge_task','admin_reset_task'
       )
  loop
    execute format('revoke all on function %s from public',      f.sig);
    execute format('revoke all on function %s from anon',        f.sig);
    execute format('revoke all on function %s from authenticated',f.sig);
  end loop;
end $$;

grant execute on function public.admin_close_task(uuid) to authenticated;
grant execute on function public.admin_reset_task(uuid) to authenticated;
grant execute on function public.admin_purge_task(uuid, text) to authenticated;

notify pgrst, 'reload schema';
