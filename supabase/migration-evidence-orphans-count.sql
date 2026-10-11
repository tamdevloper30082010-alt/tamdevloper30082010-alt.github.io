-- ============================================================================
--  Sửa nút "Dọn tệp tồn" — đếm sai, lúc nào cũng ra tổng cũ
--
--  NGUYÊN NHÂN
--
--  admin_evidence_orphans() liệt kê đường dẫn ảnh tồn bằng cách quét
--  audit_log. Mà audit_log là bảng NHẬT KÝ BẤT BIẾN: REVOKE UPDATE/DELETE,
--  không bao giờ có dòng nào bị gỡ. Nên cả 13 ảnh đã dọn từ lâu vẫn nằm
--  trong nhật ký mãi mãi ⇒ bấm nút bao nhiêu lần cũng trả về đúng 13.
--
--  Thêm nữa, phía trình duyệt coi "xoá file không tồn tại" là THÀNH CÔNG
--  (đúng ý — không còn gì để xoá), nên lần dọn thứ hai vẫn hiện "13/13"
--  dù thực tế không xoá được tệp nào.
--
--  ĐÃ KIỂM CHỨNG: storage.objects không còn dòng nào trong 13 đường dẫn đó
--  ⇒ tệp thật đã bị xoá đúng. Chỉ có con số hiển thị là sai.
--
--  CÁCH SỬA
--
--  Đếm sự thật thay vì đếm nhật ký: hỏi storage.objects xem tệp CÒN THẬT
--  trong kho không. Xoá qua Storage API sẽ xoá cả tệp lẫn dòng trong
--  storage.objects, nên đây chính là nguồn sự thật.
--
--  Ổn định hơn hẳn so với cách đánh dấu "đã dọn" trong nhật ký:
--    • tự khỏi lành — nếu tệp nào lọt lại vào kho thì lần sau thấy lại ngay
--    • không cần client nhớ đã dọn gì
--    • không sinh thêm dòng audit_log mỗi lần bấm nút
--
--  Lưu ý: search_path giữ nguyên không thêm schema storage; tham chiếu bằng
--  tên đầy đủ storage.objects. SECURITY DEFINER đọc được bảng này vì hàm
--  chạy bằng quyền của chủ sở hữu (postgres).
-- ============================================================================

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
     and a.payload->>'evidence_path' <> ''
     -- Tệp tồn = tệp VẪN CÒN trong kho (có dòng trong storage.objects).
     -- Xoá qua Storage API sẽ xoá cả tệp lẫn dòng đó, nên đường dẫn nào
     -- không còn dòng nữa là đã dọn xong và không được tính vào nữa.
     and exists (
       select 1
         from storage.objects s
        where s.bucket_id = 'task-evidence'
          and s.name = a.payload->>'evidence_path'
     );

  return v;
end $$;

revoke all on function public.admin_evidence_orphans() from public, anon;
grant execute on function public.admin_evidence_orphans() to authenticated;

notify pgrst, 'reload schema';