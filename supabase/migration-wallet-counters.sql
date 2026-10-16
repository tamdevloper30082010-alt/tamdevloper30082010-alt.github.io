-- ============================================================================
--  Sửa các chỗ đếm tiền sai trong v_wallet
--
--  Số dư (`balance_vnd`) là TỔNG MỌI DÒNG SỔ CÁI nên không thể sai — mọi
--  thao tác cộng/trừ đều đi qua sổ cái. Nhưng ba cột phụ bên cạnh thì đang
--  tính sai, và chúng hiện ra ngay trên trang Ví và trang Rút tiền.
--
--  1. total_earned_vnd — "Tổng thu nhập kiếm được"
--     Cũ:  sum(mọi dòng dương)
--     ⇒ gộp luôn cả tiền hoàn khi rút bị từ chối (refund) và cả khoản admin
--        cộng tay (adjustment). Đúng nghĩa là tiền KIẾM ĐƯỢC từ nhiệm vụ.
--     Sửa: chỉ tính type='task_reward'.
--
--  2. total_paid_vnd — "Tổng đã rút"
--     Cũ:  -sum(mọi dòng âm)
--     ⇒ gộp cả tiền đang treo khi gửi yêu cầu rút (withdraw_request) và cả
--        khoản admin trừ nợ. Đọc số này như "đã rút" là SAI, vì khoản đó chưa
--        hề ra tài khoản ngân hàng.
--     Sửa: chỉ tính type='payout'.
--
--  3. pending_withdraw_vnd — "Đang chờ xử lý"
--     Cũ:  sum(amount_vnd) filter (where type='withdraw_request')
--     ⇒ create_withdrawal_request ghi dòng ÂM (-p_amount_vnd) vì tiền bị trừ
--        ngay khi tạo yêu cầu. Tổng của các dòng âm ⇒ ra số ÂM. Ô này được
--        hiển thị với điều kiện `> 0` nên KHÔNG BAO GIỜ hiện — người dùng
--        không thấy mình đang có tiền treo.
--     Sửa: đổi dấu để thành số DƯƠNG. Số dư không đổi, nên tiền vẫn bị trừ
--     đúng một lần khi gửi yêu cầu.
-- ============================================================================

drop view if exists public.v_wallet;

create view public.v_wallet with (security_invoker = true) as
select
  p.id as user_id,
  -- Tổng mọi dòng sổ cái. Đây là số du thật, không đổi.
  coalesce(sum(t.amount_vnd), 0)::bigint as balance_vnd,
  -- Chỉ tiền kiếm được từ nhiệm vụ.
  coalesce(sum(t.amount_vnd) filter (where t.type = 'task_reward'), 0)::bigint
    as total_earned_vnd,
  -- Chỉ tiền thực sự đã rút ra. Không tính tiền đang treo và không tính
  -- khoản admin trừ nợ.
  coalesce(-sum(t.amount_vnd) filter (where t.type = 'payout'), 0)::bigint
    as total_paid_vnd,
  -- Tiền đang chờ xử lý: đổi dấu cho thành số dương vì sổ cái ghi âm.
  coalesce(-sum(t.amount_vnd) filter (where t.type = 'withdraw_request'), 0)::bigint
    as pending_withdraw_vnd,
  count(t.id)::bigint as tx_count,
  max(t.created_at) as last_activity_at
from public.profiles p
left join public.transactions t on t.user_id = p.id
group by p.id;

grant select on public.v_wallet to authenticated;

comment on column public.v_wallet.total_earned_vnd is
  'Chỉ tính giao dịch type=task_reward — không tính hoàn tiền hay điều chỉnh tay.';
comment on column public.v_wallet.total_paid_vnd is
  'Chỉ tính type=payout — tiền thực sự đã rút, không tính yêu cầu đang treo.';
comment on column public.v_wallet.pending_withdraw_vnd is
  'Số dương. Tiền đã bị trừ khỏi số dư ngay khi gửi yêu cầu, chờ admin xử lý.';

notify pgrst, 'reload schema';