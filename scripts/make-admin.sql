-- ============================================================================
--  CẤP QUYỀN QUẢN TRỊ
--
--  Chạy bằng quyền postgres qua Management API:
--    export SUPABASE_REF=<project-ref>
--    export SUPABASE_ACCESS_TOKEN=sbp_...
--    ./scripts/db.sh scripts/make-admin.sql
--
--  SỬA EMAIL Ở DÒNG DƯỚI, rồi chạy. Không có ai tự lên admin được nữa —
--  "người đăng ký đầu tiên làm admin" đã bị thu hồi quyền.
-- ============================================================================

update public.profiles
   set role = 'admin'
 where lower(email) = lower('huynhthanhtam2k10@gmail.com');

insert into public.audit_log (actor_id, action, entity, payload)
select null, 'grant_admin_manual', 'profile',
       jsonb_build_object('email', lower('huynhthanhtam2k10@gmail.com'))
 where exists (select 1 from public.profiles where lower(email) = lower('huynhthanhtam2k10@gmail.com'));

select email, role from public.profiles where role = 'admin';
