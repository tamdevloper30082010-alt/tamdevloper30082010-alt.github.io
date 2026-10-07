import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '../components/ui'
import { useToast } from '../components/Toast'
import { SplitText } from '../components/animations'
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

    toast('Tạo tài khoản thành công! Chào mừng bạn đến với Vượt Nhanh.', 'ok')
    nav('/')
    setBusy(false)
  }

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 py-6 lg:grid-cols-2 lg:py-14">
      {/* Cột thuyết phục — chỉ hiện trên desktop */}
      <div className="hidden lg:block">
        <h1 className="font-display text-4xl leading-tight font-extrabold tracking-tight">
          <SplitText text="Bắt đầu" /> <span className="text-gradient">kiếm thu nhập</span>
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
          Đăng ký miễn phí, nhận nhiệm vụ ngay và nhận thưởng khi admin duyệt
          thành quả.
        </p>

        <div className="mt-8 space-y-3">
          {[
            ['✓', 'Miễn phí trọn đời, không phí ẩn'],
            ['⚡', 'Duyệt thành quả trong thời gian ngắn'],
            ['🔒', 'Tiền ghi vào sổ cái, đối soát minh bạch'],
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
        <h2 className="font-display text-2xl font-extrabold tracking-tight lg:hidden">
          Tạo tài khoản
        </h2>
        <p className="mt-1.5 text-sm text-muted lg:hidden">
          Miễn phí. Đăng ký xong là nhận nhiệm vụ ngay.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4 lg:mt-0">
          <Field label="Tên của bạn" required htmlFor="name">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nguyễn Văn A"
              autoComplete="name"
              required
            />
          </Field>

          <Field label="Email" required htmlFor="reg-email">
            <Input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
              autoComplete="email"
              required
            />
          </Field>

          <Field label="Mật khẩu" required hint="Tối thiểu 8 ký tự" htmlFor="reg-pw">
            <Input
              id="reg-pw"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
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
            Tạo tài khoản miễn phí
          </Button>
        </form>

        <div className="hairline my-6" />

        <p className="text-center text-sm text-muted">
          Đã có tài khoản?{' '}
          <Link to="/dang-nhap" className="text-accent font-semibold hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  )
}
