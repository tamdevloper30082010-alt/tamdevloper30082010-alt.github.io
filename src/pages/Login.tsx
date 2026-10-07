import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '../components/ui'
import { useToast } from '../components/Toast'
import { SplitText } from '../components/animations'
import { supabase, errMessage } from '../lib/supabase'
import { useAuth } from '../hooks/auth'

export default function Login() {
  const nav = useNavigate()
  const toast = useToast()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw,
    })

    if (error) {
      setErr(errMessage(error, 'Email hoặc mật khẩu không đúng.'))
      setBusy(false)
      return
    }

    await refreshProfile()
    toast('Đăng nhập thành công. Chào mừng trở lại!', 'ok')
    nav('/')
    setBusy(false)
  }

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 py-6 lg:grid-cols-2 lg:py-14">
      {/* Cột thuyết phục — chỉ hiện trên desktop */}
      <div className="hidden lg:block">
        <h1 className="font-display text-4xl leading-tight font-extrabold tracking-tight">
          <SplitText text="Chào mừng" />{' '}
          <span className="text-gradient">trở lại</span>
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
          Đăng nhập để tiếp tục những nhiệm vụ bạn đang giữ, theo dõi số dư và rút
          thưởng bất cứ lúc nào.
        </p>

        <div className="mt-8 space-y-3">
          {[
            ['◎', 'Theo dõi nhiệm vụ đang giữ lượt'],
            ['🪙', 'Số dư cập nhật theo thời gian thực'],
            ['⇩', 'Rút về ngân hàng, thẻ cào hoặc game'],
          ].map(([icon, text]) => (
            <div key={text} className="flex items-center gap-3 text-sm text-muted">
              <span className="glass grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                {icon}
              </span>
              {text}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="animate-in-scale glass-strong mx-auto w-full max-w-md rounded-3xl p-6 sm:p-8">
        <h2 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
          Đăng nhập
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          Nhập thông tin tài khoản để tiếp tục.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email" required htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
              autoComplete="email"
              required
            />
          </Field>

          <Field label="Mật khẩu" required htmlFor="pw">
            <Input
              id="pw"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {err && (
            <div
              className="animate-in-left border-danger/35 bg-danger/10 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium text-danger"
              role="alert"
            >
              {err}
            </div>
          )}

          <Button type="submit" block size="lg" loading={busy} glowRing>
            Đăng nhập
          </Button>
        </form>

        <div className="hairline my-6" />

        <p className="text-center text-sm text-muted">
          Chưa có tài khoản?{' '}
          <Link to="/dang-ky" className="text-accent font-semibold hover:underline">
            Đăng ký miễn phí
          </Link>
        </p>
      </div>
    </div>
  )
}
