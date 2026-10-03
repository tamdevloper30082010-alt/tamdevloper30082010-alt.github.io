/** Chạy SQL với quyền postgres qua Management API. Chỉ dùng cho test/fixture. */
export async function execSQL(sql) {
  const ref = process.env.SUPABASE_REF
  const tok = process.env.SUPABASE_ACCESS_TOKEN
  if (!ref || !tok) throw new Error('thiếu SUPABASE_REF hoặc SUPABASE_ACCESS_TOKEN')
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      })
      const body = await r.text()
      if (r.ok) return body
      throw new Error(body)
    } catch (e) {
      if (i === 5) throw e
      await new Promise((s) => setTimeout(s, 1500 * i))
    }
  }
}
