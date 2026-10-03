import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
  )

  const apply = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem('vn-theme', t)
    } catch {
      /* private mode — bỏ qua, theme vẫn áp dụng cho phiên này */
    }
    setTheme(t)
  }, [])

  const toggle = useCallback(() => apply(theme === 'dark' ? 'light' : 'dark'), [theme, apply])

  return { theme, toggle, setTheme: apply }
}
