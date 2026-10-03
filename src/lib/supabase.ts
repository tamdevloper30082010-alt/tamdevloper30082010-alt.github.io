import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'Thiếu cấu hình Supabase. Copy .env.example thành .env rồi điền ' +
      'VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

/**
 * Chỉ dùng PUBLISHABLE key.
 * Secret key (sb_secret_… / service_role) TUYỆT ĐỐI không được đưa vào đây —
 * mọi thao tác đặc quyền đã nằm trong RLS + SECURITY DEFINER function.
 */
export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Rút thông điệp lỗi ra khỏi response của PostgRPC.
 * Hàm trong DB raise bằng tiếng Việt nên error.message gần như luôn dùng được.
 */
export function errMessage(err: unknown, fallback = 'Có lỗi xảy ra. Vui lòng thử lại.'): string {
  if (!err) return fallback
  if (typeof err === 'string') return err
  const e = err as { message?: string; details?: string; hint?: string; code?: string }

  // Lỗi RLS của Postgres: "new row violates row-level security policy"
  if (e.message?.includes('row-level security')) {
    return 'Bạn không có quyền thực hiện thao tác này.'
  }
  if (e.message?.includes('JWT') || e.code === '42501') {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  }
  return e.message || e.details || fallback
}
