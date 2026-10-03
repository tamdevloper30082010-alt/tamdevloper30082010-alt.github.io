export type Role = 'admin' | 'worker'

/**
 * Loại nhiệm vụ — thay cho "nền tảng" cũ.
 *   link  : người nhận vượt một link, nộp link kết quả (http/https)
 *   other : nhiệm vụ tự do, nộp ẢNH chứng minh đã hoàn thành
 */
export type TaskType = 'link' | 'other'

export type SubmissionStatus =
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  created_at: string
}

/** Bản công khai của nhiệm vụ — CỐ Ý không có target_url. */
export interface Task {
  id: string
  title: string
  description: string
  task_type: TaskType
  price_vnd: number
  quantity: number
  taken_count: number
  remaining: number
  status: 'open' | 'closed'
  priority: 'normal' | 'hot'
  deadline_at: string | null
  created_by: string
  created_at: string
  /** Chỉ có trong v_tasks_admin: đã ẩn khỏi bảng tin hay chưa */
  archived_at?: string | null
  /** Chỉ có trong v_tasks_admin: số lượt đã có người nhận */
  sub_count?: number
}

export interface Submission {
  id: string
  task_id: string
  worker_id: string
  /** Link thành quả — chỉ có với nhiệm vụ loại `link`. */
  result_url: string | null
  /** Đường dẫn ảnh trong bucket `task-evidence` — chỉ có với nhiệm vụ loại `other`. */
  evidence_path: string | null
  note: string
  price_vnd: number
  status: SubmissionStatus
  admin_note: string | null
  created_at: string
  submitted_at: string | null
  reviewed_at: string | null
  /* join từ v_submissions */
  title: string
  description: string
  task_type: TaskType
  priority: 'normal' | 'hot'
  deadline_at: string | null
  created_by: string
}

export interface Wallet {
  user_id: string
  balance_vnd: number
  total_earned_vnd: number
  total_paid_vnd: number
  pending_withdraw_vnd: number
  tx_count: number
  last_activity_at: string | null
}

/* ── Rút tiền ─────────────────────────────────────────────── */

export type WithdrawMethod = 'bank' | 'game' | 'card'
export type WithdrawStatus =
  | 'pending'
  | 'processing'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export interface Withdrawal {
  id: string
  user_id: string
  method: WithdrawMethod
  amount_vnd: number
  status: WithdrawStatus
  bank_code: string
  bank_holder: string
  bank_number: string
  game_platform: string
  game_account_id: string
  card_brand: string
  card_serial: string
  card_code: string
  note: string
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
  /* join từ v_withdrawals (chỉ admin thấy nhiều dòng) */
  user_email?: string
  user_name?: string
}

/** Sáu mệnh giá được phép cho nạp game và thẻ cào — database chặn đúng danh sách này. */
export const CARD_DENOMS = [5_000, 10_000, 20_000, 50_000, 100_000, 200_000] as const

/** Nạp thẳng vào tài khoản game — admin nạp, người rút chỉ cần ID tài khoản. */
export const GAME_PLATFORMS = ['Free Fire', 'Roblox', 'Liên Quân'] as const

/** Thẻ cào — admin gửi mã, người rút KHÔNG nhập mã. */
export const CARD_BRANDS = ['Viettel', 'Vinaphone', 'Zing', 'Garena', 'Khác'] as const

export const MIN_BANK_WITHDRAW = 10_000

export const METHOD_LABEL: Record<WithdrawMethod, string> = {
  game: '🎮 Nạp vào game',
  card: '🎟 Thẻ cào',
  bank: '🏦 Ngân hàng',
}

export const WITHDRAW_STATUS_LABEL: Record<WithdrawStatus, string> = {
  pending: 'Đang chờ',
  processing: 'Đang xử lý',
  approved: 'Đã hoàn thành',
  rejected: 'Bị từ chối',
  cancelled: 'Đã huỷ',
}

export const WITHDRAW_STATUS_STYLE: Record<WithdrawStatus, string> = {
  pending: 'bg-money/15 text-money',
  processing: 'bg-info/15 text-info',
  approved: 'bg-accent/15 text-accent',
  rejected: 'bg-danger/15 text-danger',
  cancelled: 'bg-muted/15 text-muted',
}

export interface Transaction {
  id: string
  user_id: string
  amount_vnd: number
  type: 'task_reward' | 'payout' | 'adjustment'
  ref_id: string | null
  note: string
  created_at: string
}

export interface AuditEntry {
  id: string
  actor_id: string | null
  action: string
  entity: string | null
  entity_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface AdminStats {
  tasks_open: number
  waiting_review: number
  in_progress: number
  workers: number
  paid_30d: number
  paid_24h: number
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  link: '🔗 Vượt link',
  other: '🧩 Nhiệm vụ khác',
}

export const TASK_TYPE_STYLE: Record<TaskType, string> = {
  link: 'bg-info/15 text-info',
  other: 'bg-accent/15 text-accent',
}

/** Một chữ tắt ngắn cho card hẹp — badge đầy đủ ở trên đã có nhãn. */
export const TASK_TYPE_SHORT: Record<TaskType, string> = {
  link: '🔗 Vượt link',
  other: '🧩 Khác',
}

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  in_progress: 'Đang làm',
  submitted: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Bị từ chối',
  cancelled: 'Đã thu hồi',
}

export const STATUS_STYLE: Record<SubmissionStatus, string> = {
  in_progress: 'bg-info/15 text-info',
  submitted: 'bg-money/15 text-money',
  approved: 'bg-accent/15 text-accent',
  rejected: 'bg-danger/15 text-danger',
  cancelled: 'bg-muted/15 text-muted',
}
