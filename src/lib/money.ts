/**
 * TIỀN — chỉ dùng số nguyên.
 * VND không có phần thập phân, nên tuyệt đối không dùng float/number phân số.
 * Mọi giá trị đi qua đây trước khi hiển thị hoặc gửi lên server.
 */

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

/** 5000 → "5.000" */
export function formatNumber(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '0'
  return nf.format(Math.trunc(v))
}

/** 5000 → "5.000 ₫" */
export function formatVnd(n: number | string): string {
  return `${formatNumber(n)} ₫`
}

/** 5000 → "5.000" (không ký hiệu, dùng cho ô nhập) */
export function plain(n: number): string {
  return nf.format(Math.trunc(n))
}

/**
 * Tối thiểu là 1 ₫, KHÔNG phải 0.
 *
 * Sổ cái có ràng buộc `amount_vnd <> 0`: một nhiệm vụ giá 0 ₫ khi admin bấm
 * Duyệt sẽ tạo ra giao dịch 0 và bị Postgres từ chối — nhiệm vụ kẹt vĩnh viễn
 * ở "chờ duyệt", không sửa được. 1 ₫ là mức thấp nhất an toàn.
 */
export const MIN_PRICE = 1

/** Trần giữ làm chốn gõ thiếu số 0: mất 100 triệu mà sổ cái append-only. */
export const MAX_PRICE = 10_000_000

/**
 * Chấp nhận "5.000", "5000", "5 000", "5,000", "5.000đ"
 * Trả về null nếu không phải số hợp lệ.
 */
export function parseVnd(input: string): number | null {
  if (typeof input !== 'string') return null
  const cleaned = input.replace(/[^\d]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isSafeInteger(n)) return null
  return n
}

export function isValidPrice(input: string): boolean {
  const n = parseVnd(input)
  return n !== null && n >= MIN_PRICE && n <= MAX_PRICE
}

export function priceHint(): string {
  return `Bất kỳ số nào từ ${formatVnd(MIN_PRICE)} trở lên, tối đa ${formatVnd(MAX_PRICE)} mỗi lượt`
}

export function validateQuantity(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 10_000
}

/** Chuẩn hoá người dùng nhập: bỏ dấu chấm, chỉ giữ số */
export function stripSeparators(input: string): string {
  return input.replace(/[^\d]/g, '')
}

/**
 * Cùng stripSeparators nhưng GIỮ dấu âm ở đầu.
 *
 * Cần cho ô "điều chỉnh số dư": bỏ hết ký tự không phải số thì dấu "-" cũng
 * biến mất, biến tính năng trừ nợ thành chỉ có thể cộng. Dấu chỉ có ý nghĩa
 * ở vị trí đầu, nên "-abc" → "-", "abc-5" → "5", "--5" → "-5".
 */
export function stripSignedSeparators(input: string): string {
  const digits = input.replace(/[^\d]/g, '')
  // Chỉ giữ dấu âm nếu nó nằm ở đầu, phía trước không có chữ hay số khác
  return /^\s*-/.test(input) ? `-${digits}` : digits
}

/** "-50.000" → -50000. Trả null nếu không phải số hợp lệ. */
export function parseSignedVnd(input: string): number | null {
  const cleaned = stripSignedSeparators(input)
  if (!cleaned || cleaned === '-') return null
  const n = Number(cleaned)
  if (!Number.isSafeInteger(n)) return null
  return n
}

/** Đọc số có dấu để hiển thị, ví dụ cột số dư. */
export function signedVnd(n: number): string {
  return n < 0 ? `−${formatNumber(Math.abs(n))}` : formatNumber(n)
}
