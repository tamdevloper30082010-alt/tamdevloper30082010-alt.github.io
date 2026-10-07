import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // ───────────────────────────────────────────────────────────────
  //  Chặn build khi thiếu cấu hình Supabase.
  //
  //  Lý do phải chặn ở đây chứ không để cho tới lúc chạy:
  //  src/lib/supabase.ts throw ngay ở top-level khi thiếu biến. Bundler
  //  phân tích tĩnh thấy module luôn ném lỗi ⇒ kết luận toàn bộ code app
  //  không bao giờ chạy tới ⇒ TƯỚC HẾT code khỏi bundle. Kết quả là
  //  `npm run build` vẫn báo "✓ built", deploy vẫn chạy, nhưng trang ra
  //  TRẮNG TRƠN mà không có một lỗi nào trên CI để ai nhìn thấy.
  //
  //  Đã gặp thật: bundle 262 KB (chỉ còn thư viện) thay vì 601 KB.
  //  Thiếu env ở đây là HỎNG LUÔN, không phải "chạy được rồi đến lúc
  //  gặp lỗi" — nên phải làm build đỏ lên.
  // ───────────────────────────────────────────────────────────────
  if (mode === 'production') {
    const missing = (['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const).filter(
      (k) => !env[k],
    )
    if (missing.length) {
      throw new Error(
        [
          '',
          '✗ Build dừng: thiếu biến môi trường ' + missing.join(', '),
          '',
          '  Trên máy: copy .env.example thành .env rồi điền giá trị.',
          '  Trên GitHub Actions: Settings → Secrets and variables →',
          '  Actions → Variables → thêm repository variable cho từng biến.',
          '',
          '  Bỏ qua kiểm tra này thì build vẫn "thành công" nhưng ra trang',
          '  trắng — code app bị bundler tước mất. Nên build phải đỏ ở đây.',
          '',
        ].join('\n'),
      )
    }
  }

  return {
    plugins: [react(), tailwindcss()],
  }
})
