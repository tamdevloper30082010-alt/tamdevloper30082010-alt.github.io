import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/*
 * Khôi phục đường dẫn gốc sau khi 404.html chuyển hướng về đây.
 * Xem public/404.html. Chạy TRƯỚC khi render để không nháy trang chủ.
 */
const saved = (() => {
  try {
    const v = sessionStorage.getItem('vn-redirect')
    sessionStorage.removeItem('vn-redirect')
    return v
  } catch {
    return null
  }
})()
if (saved && saved !== '/' && !saved.startsWith('/assets/')) {
  window.history.replaceState(null, '', saved)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
