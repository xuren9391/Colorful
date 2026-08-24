#!/usr/bin/env bash
# 等待 Pages 开通 → 触发部署 → 验证上线
set -u
cd "F:\HomeProject\Colorful"

echo "== 1. 等待 Pages 开通（最长 10 分钟，每 5 秒查询一次）=="
code=000
for i in $(seq 1 120); do
  code=$(curl -s -o /tmp/pages.json -w "%{http_code}" "https://api.github.com/repos/xuren9391/Colorful/pages")
  if [ "$code" = "200" ]; then break; fi
  sleep 5
done
if [ "$code" != "200" ]; then
  echo "RESULT: FAIL - 10 分钟内未检测到 Pages 开通"
  exit 1
fi
echo "Pages 已开通: $(head -c 300 /tmp/pages.json)"

echo "== 2. 推送空提交触发工作流 =="
git commit --allow-empty -m "ci: 触发 Pages 部署" >/dev/null
git push origin master || { echo "RESULT: FAIL - push 失败"; exit 1; }

echo "== 3. 等待工作流完成（最长 5 分钟）=="
st=""
for i in $(seq 1 30); do
  st=$(curl -s "https://api.github.com/repos/xuren9391/Colorful/actions/runs?per_page=1" | python -X utf8 -c "import json,sys; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['status'], r.get('conclusion') or '')")
  echo "[$i] $st"
  case "$st" in completed*) break ;; esac
  sleep 10
done
case "$st" in
  completed success*) ;;
  *) echo "RESULT: FAIL - 工作流状态: $st"; exit 1 ;;
esac

echo "== 4. 验证站点（最长 2 分钟）=="
code=000
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://xuren9391.github.io/Colorful/")
  echo "[$i] site http:$code"
  if [ "$code" = "200" ]; then break; fi
  sleep 10
done
css=$(curl -s -o /dev/null -w "%{http_code}" "https://xuren9391.github.io/Colorful/css/style.css")
data=$(curl -s -o /dev/null -w "%{http_code}" "https://xuren9391.github.io/Colorful/data/colors.js")
echo "css:$css data:$data"
if [ "$code" = "200" ] && [ "$css" = "200" ] && [ "$data" = "200" ]; then
  echo "RESULT: SUCCESS - https://xuren9391.github.io/Colorful/ 已上线"
else
  echo "RESULT: FAIL - 站点或资源不可达"
  exit 1
fi
