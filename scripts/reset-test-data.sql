-- Dọn toàn bộ dữ liệu test.
--
-- THỨ TỰ QUAN TRỌNG: withdrawal_requests.reviewed_by tham chiếu profiles
-- (không ON DELETE) vì dấu vết người duyệt là thứ không được phép mất trong
-- hệ thống tiền. Hệ quả: muốn xoá tài khoản từng duyệt thì phải xoá các
-- yêu cầu rút tiền của họ trước.
delete from public.withdrawal_requests
 where user_id in (select id from public.profiles where email like '%@vnsite.test');

delete from public.tasks
 where title like '%kiểm thử%'
    or title like '%tranh chấp%'
    or title like '%copy-paste%'
    or title like '%quá hạn%'
    or title like '%bỏ lượt%'
    or target_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

delete from auth.users where email like '%@vnsite.test';

select
  (select count(*) from public.tasks)               as tasks,
  (select count(*) from public.profiles)            as profiles,
  (select count(*) from public.submissions)         as subs,
  (select count(*) from public.transactions)        as txs,
  (select count(*) from public.withdrawal_requests) as wds;
