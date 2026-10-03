-- ============================================================================
--  THÔNG BÁO DISCORD
--
--  Gửi thông báo từ DATABASE, không phải từ trình duyệt.
--
--  Vì sao không cho frontend gọi webhook trực tiếp:
--    URL webhook nằm trong bundle ⇒ bất kỳ ai mở DevTools cũng lấy được, rồi
--    spam kênh Discord của bạn tới khi bị ban. Cất trong supabase_vault thì
--    không tài khoản nào đọc được bằng publishable key.
--
--  pg_net bắn HTTP bất đồng bộ. Request chỉ được gửi khi transaction COMMIT
--  ⇒ nếu nghiệp vụ bị rollback, thông báo cũng không đi. Đúng thứ tự cần thiết.
--
--  Mọi lỗi ở đây đều bị nuốt: Discord hỏng KHÔNG được làm hỏng việc đăng
--  nhiệm vụ / duyệt tiền của người dùng.
--
--  ⚠ Webhook CHỈ nhắc được role nếu chủ server bật:
--    Server Settings → Integrations → chọn webhook →
--    "Allow this webhook to mention @everyone and @here roles"
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Bí mật trong Vault
--    Chạy 1 lần bằng service key. Xem lại / đổi role ID KHÔNG cần sửa code:
--      select vault.update_secret('discord_role_id', '<role id mới>');
-- ────────────────────────────────────────────────────────────────────────────

-- (câu insert secret nằm ở cuối file, cố tình tách riêng: URL webhook là bí
--  mật, không nên nằm trong file được commit)

-- ────────────────────────────────────────────────────────────────────────────
-- 1b. Bảng cấu hình — đổi cấu hình KHÔNG cần sửa code
--
--   update public.discord_notify_rules set mention = true where event = 'withdraw_approved';
--   update public.discord_notify_rules set enabled = false where event = 'user_signup';
--
--   Mặc định chỉ "task_created" ping role: nhắc cả lúc duyệt tiền sẽ ping cả
--   server mỗi lần có người rút, ồn rồi không ai đọc.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.discord_notify_rules (
  event   text primary key check (event in (
             'task_created','evidence_approved','evidence_rejected',
             'withdraw_approved','withdraw_rejected',
             'user_signup','balance_adjusted')),
  enabled boolean not null default true,
  mention boolean not null default false
);

insert into public.discord_notify_rules (event, enabled, mention) values
  ('task_created',      true, true),
  ('evidence_approved', true, false),
  ('evidence_rejected', true, false),
  ('withdraw_approved', true, false),
  ('withdraw_rejected', true, false),
  ('user_signup',       true, false),
  ('balance_adjusted',  true, false)
on conflict (event) do nothing;

alter table public.discord_notify_rules enable row level security;

drop policy if exists dnr_read on public.discord_notify_rules;
create policy dnr_read on public.discord_notify_rules
  for select using (auth.uid() is not null);

-- Không ai sửa được từ trình duyệt: đổi cấu hình bằng SQL là chủ ý.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Bắn tin
-- ────────────────────────────────────────────────────────────────────────────

-- Tiền có dấu phân tách nghìn: 4500 → "4,500".
-- KHÔNG dùng format() với dấu phẩy trong mẫu: Postgres không có cú pháp đó.
-- Gọi sai làm cả nghiệp vụ đang chạy (đăng nhiệm vụ, duyệt tiền) chết theo.
create or replace function public.vnd_txt(p_amount bigint)
returns text language sql immutable as $$
  select to_char(p_amount, 'FM999,999,999,999') || ' ' || chr(8363);
$$;

-- Màu embed
create or replace function public.discord_color(p_ok boolean)
returns integer language sql immutable as $$
  select case when p_ok then 3066993 else 15158332 end;  -- xanh lá / đỏ
$$;

-- Đọc bí mật; trả rỗng nếu chưa cấu hình
create or replace function public.discord_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text;
begin
  select decrypted_secret into v
    from vault.decrypted_secrets
   where name = p_name
   limit 1;
  return nullif(trim(coalesce(v, '')), '');
exception
  when others then return null;   -- chưa cấu hình Vault thì coi như tắt
end $$;

/*
  p_title      : dòng đậm đầu tiên
  p_body       : mô tả ngắn (hỗ trợ markdown)
  p_fields     : jsonb object {"Tên người": "abc", ...}
  p_ok         : true = xanh (thành công), false = đỏ (từ chối/lỗi)
  p_mention    : true = nhắc role "Nhận nhiệm vụ"
*/
create or replace function public.notify_discord(
  p_event text,
  p_title text,
  p_body text default '',
  p_fields jsonb default '{}'::jsonb,
  p_ok boolean default true
) returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_url   text;
  v_role  text;
  v_lines text;
  v_key   text;
  v_val   text;
  v_embeds jsonb;
  v_body  jsonb;
  v_mention boolean := false;
begin
  -- Tắt thì thôi, không làm hỏng gì
  if not exists (select 1 from public.discord_notify_rules
                  where event = p_event and enabled) then
    return null;
  end if;
  select mention into v_mention
    from public.discord_notify_rules where event = p_event;
  v_mention := coalesce(v_mention, false);

  v_url := public.discord_secret('discord_webhook_url');
  -- Chưa cấu hình thì im lặng, KHÔNG ném lỗi: việc đăng nhiệm vụ và duyệt tiền
  -- quan trọng hơn việc có báo Discord hay không.
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

    -- allowed_mentions là thứ QUYẾT ĐỊNH việc Discord có ping thật hay không:
    --   "parse": []  → không ping gì cả, kể cả @everyone có trong nội dung
    --   "roles": [...] → cho phép ping đúng những role nằm trong danh sách
    v_body := jsonb_build_object(
      'username', 'Vượt Nhanh',
      'content',  case when v_role is not null then '<@&' || v_role || '>' else '' end,
      'embeds',   v_embeds,
      'allowed_mentions', jsonb_build_object(
        'parse', jsonb_build_array(),
        'roles', case when v_role is not null then jsonb_build_array(v_role) else '[]'::jsonb end
      )
    );

    -- pg_net 0.20 nhận `body` kiểu jsonb (không phải text như bản cũ), và tự
    -- đặt Content-Type: application/json. Truyền body::text sẽ báo
    -- "function net.http_post(url => text, body => text, ...) does not exist".
    return net.http_post(
      url     := v_url,
      body    := v_body,
      params  := '{}'::jsonb,
      headers := '{}'::jsonb
    )::text;

  exception
    when others then
      -- Discord lỗi, mạng lỗi, Vault lỗi… không được làm hỏng nghiệp vụ chính.
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('title', p_title, 'error', left(sqlerrm, 300)));
      return null;
  end;
end $$;

-- Số dư hiện tại để nhúng vào thông báo — tính thẳng từ sổ cái tại thời điểm
-- gửi, nên không bao giờ lệch với con số người dùng đang thấy.
create or replace function public.balance_of(p_user_id uuid)
returns bigint language sql stable as $$
  select coalesce(sum(t.amount_vnd), 0)::bigint
    from public.transactions t where t.user_id = p_user_id;
$$;

-- Tên hiển thị: ưu tiên tên, thiếu thì lấy email
create or replace function public.display_name(p_user_id uuid)
returns text language plpgsql stable as $$
declare v text;
begin
  select nullif(trim(coalesce(p.full_name, '')), '') into v
    from public.profiles p where p.id = p_user_id;
  if v is null then
    select nullif(trim(coalesce(u.email, '')), '') into v
      from auth.users u where u.id = p_user_id;
  end if;
  return coalesce(v, 'Không rõ');
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. QUYỀN
--    Không cấp cho anon/authenticated: nếu ai cũng gọi được notify_discord thì
--    họ gõ nội dung tuỳ ý vào kênh Discord của bạn — y hệt để lộ webhook.
--    Chỉ các hàm SECURITY DEFINER bên trong database mới gọi được.
-- ────────────────────────────────────────────────────────────────────────────
revoke all on function public.notify_discord(text,text,text,jsonb,boolean) from public, anon, authenticated;
revoke insert, update, delete on public.discord_notify_rules from anon, authenticated;
grant select on public.discord_notify_rules to authenticated;
comment on table public.discord_notify_rules is
  'Bật/tắt và cho phép ping role từng loại thông báo. Sửa bằng SQL, không sửa code.';
revoke all on function public.discord_secret(text) from public, anon, authenticated;
revoke all on function public.balance_of(uuid) from public, anon, authenticated;
revoke all on function public.display_name(uuid) from public, anon, authenticated;

-- ============================================================================
--  3. GẮN THÔNG BÁO VÀO NGHIỆP VỤ
--
--  Mỗi hàm dưới đây giữ nguyên logic cũ, chỉ thêm một lời gọi
--  notify_discord(...) ở cuối. Số dư được TÍNH LẠI tại thời điểm gửi, tức là
--  sau khi dòng sổ cái tương ứng đã được ghi — nên con số trong tin nhắn
--  luôn khớp với cái người dùng sẽ thấy.
--
--  ⚠ Khi sửa các hàm này, GIỮ NGUYÊN phần `default` của tham số. Bỏ default
--  ⇒ PostgREST không tra được hàm khi client gọi thiếu tham số ⇒ mọi lượt
--  dùng chức năng đó trả về PGRST202.
-- ============================================================================

-- ── 3.1. Admin đăng nhiệm vụ ──────────────────────────────────────────────
create or replace function public.admin_create_task(
  p_title text, p_description text, p_target_url text,
  p_task_type text, p_price_vnd bigint, p_quantity int,
  p_deadline_at timestamptz, p_priority text
) returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
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

  -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
  -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
  -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
  -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
      true
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'task_created', 'error', left(sqlerrm, 300)));
  end;

  return v_id;
end $$;

-- ── 3.2. Duyệt / từ chối thành quả ────────────────────────────────────────
drop function if exists public.admin_review_submission(uuid, boolean, text);

create or replace function public.admin_review_submission(
  p_submission_id uuid, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  s     public.submissions%rowtype;
  t     public.tasks%rowtype;
  v_ev  text;
  v_bal  bigint;
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
           -- Ảnh đã kiểm xong thì không giữ lại: xoá để tiết kiệm Storage.
           evidence_path = null,
           result_url = case when v_ev is not null then null else result_url end
     where id = p_submission_id;

    insert into public.transactions (user_id, amount_vnd, type, ref_id, note)
    values (s.worker_id, s.price_vnd, 'task_reward', p_submission_id, 'Thưởng hoàn thành nhiệm vụ');

    perform public.log_audit('approve','submission',p_submission_id,
      jsonb_build_object('amount_vnd', s.price_vnd, 'worker_id', s.worker_id,
                         'evidence_path', v_ev));

    v_bal := public.balance_of(s.worker_id);
    -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
    -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
    -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
    -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
        true
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'evidence_approved', 'error', left(sqlerrm, 300)));
    end;
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

    v_bal := public.balance_of(s.worker_id);
    -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
    -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
    -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
    -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
        false
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'evidence_rejected', 'error', left(sqlerrm, 300)));
    end;
    v_ev := null;
  end if;

  return v_ev;
end $$;

-- ── 3.3. Duyệt / từ chối rút tiền ─────────────────────────────────────────
-- Bản cũ có default ở p_note, bản mới thì không. Postgres cấm đổi default
-- khi thay hàm ⇒ phải drop trước.
drop function if exists public.admin_review_withdrawal(uuid, text, text);

create or replace function public.admin_review_withdrawal(
  p_id uuid, p_status text, p_note text
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
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
    -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
    -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
    -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
    -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
        false
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
    -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
    -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
    -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
    -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
        true
      );
    exception when others then
      perform public.log_audit('discord_notify_failed', 'notification', null,
        jsonb_build_object('event', 'withdraw_approved', 'error', left(sqlerrm, 300)));
    end;
  end if;
end $$;

-- ── 3.4. Người dùng mới + điều chỉnh số dư ────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',''));

  -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
  -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
  -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
  -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
      true
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'user_signup', 'error', left(sqlerrm, 300)));
  end;
  return new;
end $$;

create or replace function public.admin_adjust_balance(
  p_user_id uuid, p_amount_vnd bigint, p_note text
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
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
  -- Bọc gọi: lỗi ở đây KHÔNG được làm hỏng nghiệp vụ chính.
  -- Bắt buộc bọc Ở HÀM GỌI chứ không chỉ trong notify_discord: các biểu thức
  -- trong danh sách tham số được đánh giá TRƯỚC khi vào thân hàm đích, nên lỗi ở
  -- đây nổi thẳng ra ngoài khối exception bên trong notify_discord.
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
      v_bal >= 0
    );
  exception when others then
    perform public.log_audit('discord_notify_failed', 'notification', null,
      jsonb_build_object('event', 'balance_adjusted', 'error', left(sqlerrm, 300)));
  end;
end $$;

-- ── 3.5. Quyền + nạp lại schema cache ─────────────────────────────────────
revoke all on function public.notify_discord(text,text,text,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.balance_of(uuid) from public, anon, authenticated;
revoke all on function public.display_name(uuid) from public, anon, authenticated;
revoke all on function public.discord_color(boolean) from public, anon, authenticated;

grant execute on function public.admin_create_task(text,text,text,text,bigint,int,timestamptz,text) to authenticated;
grant execute on function public.admin_review_submission(uuid,boolean,text) to authenticated;
grant execute on function public.admin_review_withdrawal(uuid,text,text) to authenticated;
grant execute on function public.admin_adjust_balance(uuid,bigint,text) to authenticated;

-- Đổi thân hàm ⇒ PostgREST vẫn giữ cache cũ. Bắn NOTIFY cho nó nạp lại ngay.
notify pgrst, 'reload schema';

-- ============================================================================
--  4. CẤU HÌNH LẦN ĐẦU (chạy tay, 1 lần — có chứa bí mật)
--
--  Webhook URL KHÔNG được commit vào git. Chạy:
--    select vault.create_secret('<webhook url>', 'discord_webhook_url', 'Webhook Discord');
--    select vault.create_secret('<role id>',   'discord_role_id',   'Role Discord được nhắc');
--
--  Trong nội dung có <@&role_id> mà Discord không ping role, thì vào
--  Server Settings → Integrations → chọn webhook → bật
--  "Allow this webhook to mention @everyone and @here roles".
-- ============================================================================
