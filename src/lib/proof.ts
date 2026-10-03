/**
 * Ảnh bằng chứng cho nhiệm vụ loại "khác".
 *
 * Vòng đời của một ảnh:
 *   1. Người nhận chọn ảnh  →  upload vào bucket `task-evidence`
 *   2. Gửi duyệt            →  database giữ `evidence_path`
 *   3. Admin bấm Duyệt      →  database xoá `evidence_path` và TRẢ LẠI đường dẫn
 *   4. Frontend xoá file    →  bucket trống lại, không phí dung lượng
 *
 * Vì sao bước 3–4 tách đôi? Postgres không xoá được file trong Storage
 * (đó là dịch vụ riêng, cần service key mà frontend không được có).
 * Nên database giao "đường dẫn cần xoá" cho client, client xoá giúp.
 * Nếu mạng chết giữa chừng thì `purgeEvidence` quét lại nhật ký kiểm toán
 * để xoá nốt — xem `admin_evidence_orphans()`.
 */
import { supabase, errMessage } from './supabase'

export const EVIDENCE_BUCKET = 'task-evidence'

/** Khớp với file_size_limit của bucket (5 MB). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024

const ACCEPT = 'image/jpeg,image/png,image/webp'

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function evidenceAccept(): string {
  return ACCEPT
}

export function evidenceSizeLabel(): string {
  return `${MAX_EVIDENCE_BYTES / 1024 / 1024} MB`
}

export function evidenceExt(mime: string): string | null {
  return EXT[mime.toLowerCase()] ?? null
}

/** Đường dẫn phải nằm trong thư mục tên tài khoản — RLS và RPC đều kiểm tra lại. */
export function evidencePath(userId: string, submissionId: string, file: File): string {
  const ext = evidenceExt(file.type) ?? 'jpg'
  return `${userId}/${submissionId}-${Date.now()}.${ext}`
}

export async function uploadEvidence(
  userId: string,
  submissionId: string,
  file: File,
): Promise<string> {
  const path = evidencePath(userId, submissionId, file)
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(errMessage(error, 'Không tải được ảnh lên. Thử lại xem nhé.'))
  return path
}

/**
 * Link có chữ ký để xem ảnh — bucket là private nên không có link này
 * thì không ai xem được ảnh (kể cả admin).
 */
export async function evidenceUrl(path: string, seconds = 900): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, seconds)
  if (error) return null
  return data.signedUrl
}

/**
 * Xoá ảnh. Trả về true nếu xoá được (hoặc ảnh đã không còn ở đó).
 * Không ném lỗi — chỗ gọi coi đây là việc dọn dẹp, thất bại thì chạy lại sau.
 */
export async function removeEvidence(path: string | null | undefined): Promise<boolean> {
  if (!path) return true
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path])
  // "không tìm thấy" cũng là kết quả mong muốn — không còn gì để xoá
  if (!error) return true
  const msg = (error as { message?: string }).message ?? ''
  return /not found|does not exist|404/i.test(msg)
}
