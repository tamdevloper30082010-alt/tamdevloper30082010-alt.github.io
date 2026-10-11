/**
 * Lớp không khí: hạt sáng rơi chậm phía sau nội dung.
 *
 * Vì sao dùng div + CSS chứ không dùng canvas + requestAnimationFrame:
 *   Mỗi hạt chỉ một `transform` thay đổi liên tục ⇒ trình duyệt đẩy sang
 *   GPU, không tốn frame JS nào. Canvas + rAF sẽ ép main thread chạy vòng
 *   lặp 60fps ngay cả khi trang đang đọc — trên điện thoại làm nóng máy
 *   và hao pin, đổi lại không thêm được gì so với CSS.
 *
 * Số hạt cố tình ít (mặc định 22) và kích thước nhỏ: đủ để cảm nhận "không
 * gian đang chuyển động" mà không thành mưa tuyết hay nhiễu loạn chữ.
 */
import { useMemo } from 'react'

interface Mote {
  left: number
  size: number
  dur: number
  delay: number
  drift: number
  opacity: number
  hue: 'accent' | 'money' | 'info' | 'accent2'
}

const HUE: Record<Mote['hue'], string> = {
  accent: 'var(--c-accent)',
  money: 'var(--c-money)',
  info: 'var(--c-info)',
  accent2: 'var(--c-accent-2)',
}

export function FallingMotes({ count = 22 }: { count?: number }) {
  // Máy yếu chỉ cần vài hạt để thấy không khí; nhiều hạt chỉ tốn pin.
  const n = useMemo(() => {
    if (typeof window === 'undefined') return count
    const weak = window.matchMedia('(max-width: 768px)').matches
    return weak ? Math.min(count, 12) : count
  }, [count])

  const motes = useMemo<Mote[]>(
    () =>
      Array.from({ length: n }, (_, i) => {
        // Hạt chia đều theo cột rồi cộng nhiễu, để không dồn cục bất ngờ
        const slot = (i * 100) / n + Math.sin(i * 12.9898) * 7
        return {
          left: Math.min(97, Math.max(3, slot)),
          size: 1.6 + Math.abs(Math.sin(i * 7.13)) * 2.6,
          dur: 13 + Math.abs(Math.sin(i * 3.77)) * 12,
          delay: -Math.abs(Math.sin(i * 5.21)) * 20,
          drift: (Math.sin(i * 9.11) * 34) | 0,
          opacity: 0.16 + Math.abs(Math.sin(i * 4.31)) * 0.3,
          hue: (['accent', 'info', 'money', 'accent2'] as const)[i % 4],
        }
      }),
    [n],
  )

  return (
    <div className="motes" aria-hidden>
      {motes.map((m, i) => (
        <span
          key={i}
          className="mote"
          style={
            {
              left: `${m.left}%`,
              width: m.size,
              height: m.size,
              opacity: m.opacity,
              background: `radial-gradient(circle, ${HUE[m.hue]} 0%, transparent 70%)`,
              animationDuration: `${m.dur}s`,
              animationDelay: `${m.delay}s`,
              '--drift': `${m.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}