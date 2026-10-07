/**
 * Chuyển động — gom ở một chỗ để component không phải tự viết useEffect.
 *
 * Tất cả đều tôn trọng prefers-reduced-motion: người dùng bật "giảm chuyển động"
 * thì hook trả về giá trị cuối ngay, không gắn listener, không tốn frame nào.
 */
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cx } from './ui'

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Phần tử đã nằm trong khung nhìn (hoặc sắp lọt vào) chưa?
 *
 * Bắt buộc có: IntersectionObserver KHÔNG chắc chắn bắn callback — vào lúc
 * tab vừa mở, khi trình duyệt chưa vẽ frame nào, hay ở một số môi trường
 * headless, callback có thể không bao giờ tới. Nếu ta để nội dung ẩn mặc
 * định rồi mới chờ JS bật, một lần callback không tới là nội dung vĩnh viễn
 * biến mất — người dùng chỉ thấy trang trắng mà không có lý do gì.
 *
 * Nên: kiểm tra bằng getBoundingClientRect trước. Đã trong khung thì xử lý
 * ngay, khỏi chờ. Chuyển động là phần thêm, không phải điều kiện để hiện.
 */
function inViewport(el: Element, margin = 80) {
  const r = el.getBoundingClientRect()
  return r.top < window.innerHeight + margin && r.bottom > -margin
}

/* ── Lộ dần khi cuộn tới ──────────────────────────────────────────
   Một IntersectionObserver dùng chung cho cả trang: hook đăng ký phần tử
   vào danh sách, observer tự gọi lại khi danh sách rỗng. Mỗi phần tử có
   "đã hiện" riêng nên không hiện lại lần hai khi cuộn ngược lên. */
const revealed = new WeakSet<Element>()
let observer: IntersectionObserver | null = null
const waiting = new Set<Element>()
const callbacks = new WeakMap<Element, () => void>()

function ensureObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        revealed.add(e.target)
        callbacks.get(e.target)?.()
        waiting.delete(e.target)
        observer!.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  )
  for (const el of waiting) observer.observe(el)
}

export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  /** Trễ (ms) trước khi hiện — dùng để lần lượt (stagger) */
  delay?: number
  as?: 'div' | 'section' | 'li' | 'article' | 'span'
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-in')
      return
    }
    if (revealed.has(el)) {
      el.classList.add('is-in')
      return
    }
    // Đã lọt vào khung nhìn lúc mount thì hiện luôn, đừng chờ callback
    if (inViewport(el)) {
      revealed.add(el)
      el.classList.add('is-in')
      return
    }

    callbacks.set(el, () => el.classList.add('is-in'))
    waiting.add(el)
    ensureObserver()
    observer?.observe(el)

    return () => {
      waiting.delete(el)
      observer?.unobserve(el)
    }
  }, [])

  return (
    <Tag
      ref={ref as never}
      className={cx('reveal', className)}
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  )
}

/* ── Số đếm tăng dần ──────────────────────────────────────────────
   Dùng requestAnimationFrame + easing ra. Không thêm thư viện. */
/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(target)
  const ref = useRef<HTMLSpanElement>(null)
  // Đích ĐÃ đếm xong. Phải nhớ GIÁ TRỊ chứ không phải cờ boolean: số liệu
  // trang chủ về sau từ 0 lên N, nếu chỉ có cờ boolean thì lần tăng thứ hai
  // bị bỏ qua và con số kẹt luôn ở 0.
  const counted = useRef<number | null>(null)
  const rafRef = useRef(0)

  // easeOutExpo — nhanh lúc đầu, chậm dần về đích. Tách riêng để cả
  // đường "đếm ngay" và "đếm khi lọt vào khung nhìn" dùng chung.
  const runCount = (from: number) => {
    const start = performance.now()
    cancelAnimationFrame(rafRef.current)
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
      setValue(Math.round(from + (target - from) * eased))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      counted.current = target
      setValue(target)
      return
    }
    if (counted.current === target) return

    // Đã lọt vào khung nhìn lúc mount thì chạy ngay, khỏi chờ callback —
    // xem giải thích ở inViewport().
    if (inViewport(el)) {
      counted.current = target
      runCount(value)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()
        counted.current = target
        runCount(value)
      },
      { threshold: 0.4 },
    )
    io.observe(el)

    return () => {
      io.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
    // `value` cố ý không nằm trong deps: chỉ dùng làm điểm xuất phát khi
    // bắt đầu một lần đếm mới, không phải để đếm lại liên tục.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return { ref, value }
}

/** Bọc con số để nó tự đếm khi lọt vào khung nhìn. */
/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function CountUp({
  value,
  format = (n) => n.toLocaleString('vi-VN'),
  className,
  duration,
}: {
  value: number
  format?: (n: number) => string
  className?: string
  duration?: number
}) {
  const { ref, value: v } = useCountUp(value, duration)
  return (
    <span ref={ref} className={className}>
      {format(v)}
    </span>
  )
}

/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function useRipple() {
  return (e: React.MouseEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const span = document.createElement('span')
    span.className = 'ripple'
    span.style.width = span.style.height = `${size}px`
    span.style.left = `${e.clientX - rect.left - size / 2}px`
    span.style.top = `${e.clientY - rect.top - size / 2}px`
    el.appendChild(span)
    setTimeout(() => span.remove(), 620)
  }
}

/* ── Ánh sáng bám con trỏ ─────────────────────────────────────────
   Ghi vị trí chuột vào biến CSS --mx/--my để .spotlight dựng gradient. */
/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    el.addEventListener('pointermove', move)
    return () => {
      el.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])

  return ref
}

/* ── Nút bị "hút" về phía con trỏ ─────────────────────────────────
   Trên thiết bị có chuột mới bật; trên điện thoại vô nghĩa. */
/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function useMagnetic<T extends HTMLElement>(strength = 0.22) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        el.style.transform = `translate3d(${dx * strength}px, ${dy * strength}px, 0)`
      })
    }
    const leave = () => {
      el.style.transition = 'transform 0.5s var(--ease-spring)'
      el.style.transform = 'translate3d(0,0,0)'
      setTimeout(() => {
        el.style.transition = ''
      }, 500)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      cancelAnimationFrame(raf)
    }
  }, [strength])

  return ref
}
/* ── Tiêu đề hiện từng từ ────────────────────────────────────────
   perWord = true  : từng từ bay lên lần lượt (tiêu đề thường)
   perWord = false : cả dòng bay lên như một khối

   Vì sao dòng gradient phải dùng perWord=false:
   `background-clip: text` không vẽ xuyên qua phần tử con đã tạo stacking
   context (inline-block + animation). Dòng gradient sẽ CÓ layout đúng
   nhưng vẽ ra trống — nhìn như mất chữ mà không có lỗi nào báo ra, rất
   khó phát hiện. Nên gradient phải nằm trên chính phần tử được animate. */
/* eslint-disable-next-line react-refresh/only-export-components -- file gộp component + hook, chấp nhận mất fast refresh */
export function SplitText({
  text,
  className,
  delay = 0,
  perWord = true,
}: {
  text: string
  className?: string
  delay?: number
  perWord?: boolean
}) {
  if (prefersReducedMotion()) {
    return <span className={className}>{text}</span>
  }

  // Dòng gradient: animation đặt ở VỎ, className (text-gradient) đặt ở LÕI.
  // Đảo lại thứ tự này thì Chrome không vẽ được background-clip:text trên
  // phần tử đang có transform — dòng có layout nhưng trống hoàn toàn.
  if (!perWord) {
    return (
      <span
        className="inline-block"
        style={{ animation: `fade-up 0.7s var(--ease-out-expo) ${delay}ms both` }}
      >
        <span className={className}>{text}</span>
      </span>
    )
  }

  // Khoảng trắng phải là ANH EM của span chứ không nằm bên trong: inline-block
  // là block container riêng nên dấu cách ở cuối nội dung của nó bị bỏ.
  const words = text.split(' ')
  return (
    <span className={className}>
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <span
            className="inline-block"
            style={{
              animation: `fade-up 0.6s var(--ease-out-expo) ${delay + i * 55}ms both`,
            }}
          >
            {w}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </span>
  )
}
