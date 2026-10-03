#!/usr/bin/env python3
"""
Đẩy code lên GitHub qua REST API thay vì git push.
Cần thiết khi git không xác minh được chứng chỉ TLS trong môi trường CI này.
"""
import base64, json, os, subprocess, sys, urllib.request, urllib.error

TOKEN = os.environ["GITHUB_PAT"]
OWNER = os.environ["GH_OWNER"]
REPO = os.environ["GH_REPO"]
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
ROOT = os.path.dirname(os.path.abspath(__file__)) + "/.."

def api(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (502, 503, 504) and attempt < 5:
                print(f"    tạm lỗi {e.code}, thử lại…", flush=True)
                import time; time.sleep(3 * (attempt + 1)); continue
            raise SystemExit(f"{method} {path} → HTTP {e.code}\n{detail}")

# file nào thực sự được git theo dõi (tôn trọng .gitignore)
tracked = subprocess.run(
    ["git", "-C", ROOT, "ls-files"], capture_output=True, text=True, check=True
).stdout.split()
print(f"đẩy {len(tracked)} file lên {OWNER}/{REPO}")

blobs = []
for path in tracked:
    with open(os.path.join(ROOT, path), "rb") as f:
        raw = f.read()
    enc = base64.b64encode(raw).decode()
    sha = api("POST", "/git/blobs", {"content": enc, "encoding": "base64"})["sha"]
    blobs.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
    print(f"  ✓ {path}")

tree = api("POST", "/git/trees", {"tree": blobs})["sha"]
commit = api("POST", "/git/commits", {
    "message": "Sàn nhiệm vụ vượt liên kết + GitHub Pages\n\n"
               "Người nhận: nhận nhiệm vụ, xem link cần vượt, gửi link thành quả.\n"
               "Admin: đăng nhiệm vụ đặt giá VND, duyệt thành quả, xử lý rút tiền.\n\n"
               "Mọi thứ liên quan tiền nằm ở tầng database, không tin JavaScript:\n"
               "- Số dư là VIEW tính từ sổ cái, không phải cột lưu\n"
               "- Sổ cái append-only, REVOKE UPDATE/DELETE\n"
               "- Không có secret key trong web; đặc quyền qua RLS + SECURITY DEFINER\n"
               "- FOR UPDATE chặn vượt số lượt và cộng tiền hai lần khi gọi song song\n"
               "- Rút tiền trừ ngay lúc gửi yêu cầu, từ chối thì hoàn tiền\n"
               "- Thẻ cào không thể hoàn thành khi chưa có mã do admin giao\n",
    "tree": tree, "parents": [],
})["sha"]
print(f"commit: {sha[:7] if (sha := commit) else ''}")

try:
    api("PATCH", "/git/refs/heads/main", {"sha": commit, "force": True})
    print("đã tạo branch main")
except SystemExit as e:
    if "Reference does not exist" in str(e):
        api("POST", "/git/refs", {"ref": "refs/heads/main", "sha": commit})
        print("đã tạo branch main (mới hoàn toàn)")
    else:
        raise

print(f"\nXong: https://github.com/{OWNER}/{REPO}")
