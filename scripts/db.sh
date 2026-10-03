#!/bin/bash
# Chạy SQL lên project Supabase qua Management API, có retry cho lỗi mạng.
# PAT đọc từ biến môi trường SUPABASE_ACCESS_TOKEN — KHÔNG ghi vào file.
set -u
REF="${SUPABASE_REF:?cần SUPABASE_REF}"
FILE="$1"
LABEL="${2:-apply}"

python3 -c "
import json,sys
q=open('$FILE').read()
open('/tmp/_q.json','w').write(json.dumps({'query': q}))
"

for i in 1 2 3 4 5 6; do
  RESP=$(curl -sS -w "\n%{http_code}" -X POST \
    "https://api.supabase.com/v1/projects/${REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/_q.json 2>&1)
  CODE=$(printf '%s' "$RESP" | tail -n1)
  BODY=$(printf '%s' "$RESP" | sed '$d')

  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    echo "[$LABEL] OK (HTTP $CODE) ${BODY:0:400}"
    exit 0
  fi
  echo "[$LABEL] lần $i lỗi (HTTP $CODE) — thử lại sau 4s" >&2
  printf '%s' "$BODY" | head -c 300 >&2; echo >&2
  sleep 4
done

echo "[$LABEL] THẤT BẠI sau nhiều lần thử" >&2
exit 1
