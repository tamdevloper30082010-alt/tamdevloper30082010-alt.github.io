import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/auth'
import { supabase, errMessage } from '../lib/supabase'

export default function Register() {
  const nav = useNavigate()
  const toast = useToast()
  const { refreshProfile } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')

    if (name.trim().length < 2) return setErr('Vui lòng nhập tên của bạn.')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Email không hợp lệ.')
    if (pw.length < 8) return setErr('Mật khẩu phải có ít nhất 8 ký tự.')

    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pw,
      options: { data: { full_name: name.trim() } },
    })

    if (error) {
      setErr(errMessage(error, 'Không đăng ký được.'))
      setBusy(false)
      return
    }

    // KHÔNG tự cấp quyền admin cho người đăng ký. Quyền admin chỉ cấp thủ công
    // bằng scripts/make-admin.sql — "ai đăng ký trước thì làm admin" là lỗ hổng
    // trên trang public, ai cũng đăng ký trước chủ sở hữu được.
    //
    // Vẫn phải nạp lại profile: signUp() đã bắn onAuthStateChange và app đọc
    // hồ sơ trước khi ta kịp thay đổi gì. Không nạp lại thì giao diện giữ
    // dữ liệu cũ và hiển thị sai.
    await refreshProfile()

    toast('Đăng ký thành công!', 'ok')
    nav('/')
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="animate-in glass rounded-2xl p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Tạo tài khoản</h1>
        <p className="mt-1.5 text-sm text-muted">
          Miễn phí. Đăng ký xong là nhận nhiệm vụ ngay.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Tên của bạn" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nguyễn Văn A"
              autoComplete="name"
            />
          </Field>

          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Mật khẩu" required hint="Tối thiểu 8 ký tự">
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>

          {err && (
            <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2.5 text-[13px] font-medium text-danger">
              {err}
            </div>
          )}

          <Button type="submit" block size="lg" loading={busy}>
            Đăng ký
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          Đã có tài khoản?{' '}
          <Link to="/dang-nhap" className="font-semibold text-accent hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  )
}
