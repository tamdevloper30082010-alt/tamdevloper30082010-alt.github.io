/**
 * ẢNH / VIDEO THÀNH QUẢ cho nhiệm vụ loại "khác".
 *
 * Vòng đời của một tệp bằng chứng:
 *   1. Người nhận chọn ảnh hoặc video → upload vào bucket `task-evidence`
 *   2. Gửi duyệt              →  database giữ `evidence_path`
 *   3. Admin bấm Duyệt        →  database xoá `evidence_path` và TRẢ LẠI đường dẫn
 *   4. Frontend xoá tệp       →  bucket trống lại, không phí dung lượng
 *
 * Vì sao bước 3–4 tách đôi? Postgres không xoá được file trong Storage
 * (đó là dịch vụ riêng, cần service key mà frontend không được có).
 * Nên database giao "đường dẫn cần xoá" cho client, client xoá giúp.
 * Nếu mạng chết giữa chừng thì `purgeEvidence` quét lại nhật ký kiểm toán
 * để xoá nốt — xem `admin_evidence_orphans()`.
 */
import { supabase, errMessage } from './supabase'

export const EVIDENCE_BUCKET = 'task-evidence'

/**
 * Khớp với `file_size_limit` của bucket (20 MB).
 *
 * Video nặng hơn ảnh nhiều nên đây là hạn mềm: mặc định giao diện có bảng
 * 1 GB, nên nếu tồn đọng nhiều video chờ duyệt cùng lúc thì hết chỗ.
 * Dùng video ngắn, quay 720p là thoải mái trong 20 MB.
 */
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024

export type EvidenceKind = 'image' | 'video'

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime'

/** mime → đuôi file. Chỉ những đuôi mà trình duyệt thực sự phát được. */
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/** iPhone hay xuất .mov — Chrome không phát được nên cảnh báo trước. */
const WARN_MIME: Record<string, string> = {
  'video/quicktime':
    'File .mov chỉ mở được trên Safari/iPhone. Nếu muốn mọi người đều xem được, hãy xuất sang MP4.',
  'video/x-m4v': 'File .m4v có thể không phát trên mọi trình duyệt. MP4 an toàn hơn.',
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

export function evidenceKind(mime: string): EvidenceKind {
  return mime.toLowerCase().startsWith('video/') ? 'video' : 'image'
}

/** Cảnh báo mềm về định dạng — vẫn cho nộp, chỉ nhắc để chọn định dạng phát được. */
export function evidenceWarning(mime: string): string | null {
  return WARN_MIME[mime.toLowerCase()] ?? null
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
  if (error) {
    // Bucket chặn cả sai mime lẫn quá dung lượng; thông điệp Postgres gọn
    // hơn thông điệp mặc định nên hiện luôn.
    throw new Error(errMessage(error, 'Không tải được tệp lên. Thử lại xem nhé.'))
  }
  return path
}

/**
 * Link có chữ ký để xem — bucket là private nên không có link này
 * thì không ai xem được (kể cả admin).
 */
export async function evidenceUrl(path: string, seconds = 900): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, seconds)
  if (error) return null
  return data.signedUrl
}

export function isVideoPath(path: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(path)
}

/**
 * Xoá tệp. Trả về true nếu xoá được (hoặc tệp đã không còn ở đó).
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

/**
 * Kiểu tệp đã lưu, suy ra từ đường dẫn.
 *
 * Đường dẫn do `evidencePath()` sinh ra nên đuôi file luôn đúng với mime
 * lúc upload — không cần lưu thêm cột vào database chỉ để nhớ là ảnh hay video.
 */
export function evidenceKindFromPath(path: string): EvidenceKind {
  return isVideoPath(path) ? 'video' : 'image'
}
