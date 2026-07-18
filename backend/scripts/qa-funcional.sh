#!/usr/bin/env bash
# QA funcional — Passe 1: toda função exercitada via API real, com o usuário dev.
# Uso: bash scripts/qa-funcional.sh
set -u
API=http://localhost:4000/api
POST=319f1527-b645-45f9-90c6-46439d91e6d5   # deck de 4 slides (barato p/ exports)
PASS=0; FAIL=0

check() { # check <nome> <esperado> <obtido>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 (esperado $2, veio $3)"; fi
}

TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"gustavo@tzolkin.dev","password":"Tzolkin#2026"}' | python -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
[ -n "$TOKEN" ] && echo "PASS  auth/login" || { echo "FAIL auth/login"; exit 1; }
A="Authorization: Bearer $TOKEN"

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# ── Marcas / brandkit / permissões ──
check "brands/list"        200 "$(code $API/brands -H "$A")"
check "brands/get tzolkin" 200 "$(code $API/brands/tzolkin -H "$A")"
check "brands/posts (galeria)" 200 "$(code $API/brands/tzolkin/posts -H "$A")"
check "brands/ai-usage"    200 "$(code "$API/brands/tzolkin/ai-usage" -H "$A")"
check "brands/billing"     200 "$(code "$API/brands/tzolkin/ai-usage/billing" -H "$A")"

# ── Posts / galeria ──
check "brands/assets (mídia)" 200 "$(code $API/brands/tzolkin/assets -H "$A")"
check "posts/get"          200 "$(code $API/posts/$POST -H "$A")"
check "posts/versions"     200 "$(code $API/posts/$POST/versions -H "$A")"

# ── Pastas (CRUD completo) ──
FID=$(curl -s -X POST $API/folders/tzolkin -H "$A" -H "Content-Type: application/json" \
  -d '{"name":"QA Teste"}' | python -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
[ -n "$FID" ] && echo "PASS  folders/create" && PASS=$((PASS+1)) || { echo "FAIL  folders/create"; FAIL=$((FAIL+1)); }
if [ -n "$FID" ]; then
  check "folders/rename"   200 "$(code -X PATCH $API/folders/$FID -H "$A" -H "Content-Type: application/json" -d '{"name":"QA Renomeada"}')"
  check "folders/delete"   200 "$(code -X DELETE $API/folders/$FID -H "$A")"
fi

# ── Export de UM slide (imediato) ──
check "export slide png"   200 "$(code "$API/posts/$POST/export?slide=0&format=png" -H "$A")"
check "export slide html"  200 "$(code "$API/posts/$POST/export?slide=0&format=html" -H "$A")"

# ── Export do deck (job): PDF e ZIP de ponta a ponta ──
for FMT in pdf zip; do
  JOB=$(curl -s -X POST $API/posts/$POST/export-file -H "$A" -H "Content-Type: application/json" \
    -d "{\"format\":\"$FMT\"}" | python -c "import sys,json; print(json.load(sys.stdin)['data']['jobId'])" 2>/dev/null)
  OK=timeout
  for i in $(seq 1 40); do
    ST=$(curl -s "$API/posts/$POST/export-file/$JOB" -H "$A" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
print(d['status'], 1 if d.get('result') else 0)" 2>/dev/null)
    S=$(echo $ST | cut -d' ' -f1); R=$(echo $ST | cut -d' ' -f2)
    if [ "$S" = "completed" ] && [ "$R" = "1" ]; then OK=ok; break; fi
    if [ "$S" = "failed" ]; then OK=failed; break; fi
    sleep 3
  done
  check "export deck $FMT (job completo + resultado)" ok "$OK"
  if [ "$OK" = "ok" ]; then
    check "download proxy $FMT" 200 "$(code "$API/posts/$POST/export-file/$JOB/download" -H "$A")"
  fi
done

# ── Edição por código (primitiva) + restore ──
SLIDE_HTML=$(curl -s $API/posts/$POST -H "$A" | python -c "
import sys,json
c=json.load(sys.stdin)['data']['content']
print(json.dumps(c['slides'][0]['html']))" 2>/dev/null)
RES=$(curl -s -X PUT $API/posts/$POST/slides/0/code -H "$A" -H "Content-Type: application/json" \
  -d "{\"html\":$SLIDE_HTML}" -o /dev/null -w "%{http_code}")
check "slides/code (PUT idempotente)" 200 "$RES"

# ── Notificações / equipe / canva ──
check "notifications"      200 "$(code $API/notifications -H "$A")"
check "team/members"       200 "$(code "$API/brands/tzolkin/members" -H "$A" || echo 000)"
check "canva/status"       200 "$(code $API/canva/tzolkin/status -H "$A")"

# ── Fábrica: sessão nova ──
check "fabrica/session"    200 "$(code -X POST $API/fabrica/sessions -H "$A" -H "Content-Type: application/json" -d '{"brandSlug":"tzolkin"}')"

echo ""
echo "══════════════════════════════"
echo "PASS: $PASS · FAIL: $FAIL"
