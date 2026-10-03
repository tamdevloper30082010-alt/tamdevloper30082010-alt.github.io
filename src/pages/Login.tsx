import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '../components/ui'
import { useToast } from '../components/Toast'
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
    toast('Đăng nhập thành công!', 'ok')
    nav('/')
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="animate-in glass rounded-2xl p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Đăng nhập</h1>
        <p className="mt-1.5 text-sm text-muted">Chào mừng trở lại 👋</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Mật khẩu" required>
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          {err && (
            <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2.5 text-[13px] font-medium text-danger">
              {err}
            </div>
          )}

          <Button type="submit" block size="lg" loading={busy}>
            Đăng nhập
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          Chưa có tài khoản?{' '}
          <Link to="/dang-ky" className="font-semibold text-accent hover:underline">
            Đăng ký ngay
          </Link>
        </p>
      </div>
    </div>
  )
}
