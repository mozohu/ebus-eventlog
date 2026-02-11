#!/bin/bash
# ebus-eventlog 測試腳本
# 用法: ./test.sh [API_URL]

API_URL="${1:-http://localhost:4000}"

echo "🧪 ebus-eventlog 測試腳本"
echo "📡 API URL: $API_URL"
echo ""

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# 測試函數
test_query() {
    local name="$1"
    local query="$2"
    local expected="$3"
    
    echo -n "測試: $name ... "
    
    response=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "$query")
    
    if echo "$response" | grep -q "$expected"; then
        echo -e "${GREEN}✓ 通過${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗ 失敗${NC}"
        echo "  回應: $response"
        ((FAIL++))
        return 1
    fi
}

echo "=== 1. 基本連線測試 ==="
test_query "GraphQL 端點" \
    '{"query":"{ __typename }"}' \
    '"__typename":"Query"'

echo ""
echo "=== 2. 建立測試資料 ==="

# 建立單筆 trigger
test_query "建立單筆 trigger" \
    '{"query":"mutation { createTrigger(input: { timestamp: 1770454586034248, e: \"auth/goto_none\", arg: {}, s: \"./auth.pl\", can: 0, sm: \"auth\", trigger: \"goto_none\", st: \"none\", deviceId: \"test-device-001\" }) { id timestamp e } }"}' \
    '"e":"auth/goto_none"'

# 批次建立 triggers
test_query "批次建立 triggers" \
    '{"query":"mutation { createTriggers(inputs: [ { timestamp: 1770454589390960, e: \"sys/start\", sm: \"sys\", trigger: \"start\", st: \"none\", deviceId: \"test-device-001\" }, { timestamp: 1770454589667525, e: \"sys/sys_op\", sm: \"sys\", trigger: \"sys_op\", st: \"INIT\", deviceId: \"test-device-001\" } ]) { id } }"}' \
    '"id"'

# 建立 transition
test_query "建立 transition" \
    '{"query":"mutation { createTransition(input: { timestamp: 1770454589391700, e: \"sys/before_start\", sm: \"sys\", transition: \"before_start\", fst: \"none\", tst: \"INIT\", deviceId: \"test-device-001\" }) { id transition fst tst } }"}' \
    '"transition":"before_start"'

# 批次建立 transitions
test_query "批次建立 transitions" \
    '{"query":"mutation { createTransitions(inputs: [ { timestamp: 1770454589392331, e: \"sys/leave_none\", sm: \"sys\", transition: \"leave_none\", fst: \"none\", tst: \"INIT\", deviceId: \"test-device-001\" }, { timestamp: 1770454589393082, e: \"sys/enter_INIT\", sm: \"sys\", transition: \"enter_INIT\", fst: \"none\", tst: \"INIT\", deviceId: \"test-device-001\" } ]) { id } }"}' \
    '"id"'

echo ""
echo "=== 3. 查詢測試 ==="

# 查詢 triggers
test_query "查詢所有 triggers" \
    '{"query":"{ triggers(limit: 10) { id e sm trigger st deviceId } }"}' \
    '"triggers"'

# 以 deviceId 查詢
test_query "以 deviceId 查詢 triggers" \
    '{"query":"{ triggers(deviceId: \"test-device-001\", limit: 5) { id e deviceId } }"}' \
    '"deviceId":"test-device-001"'

# 以 sm 查詢
test_query "以 sm 查詢 triggers" \
    '{"query":"{ triggers(sm: \"sys\", limit: 5) { id e sm } }"}' \
    '"sm":"sys"'

# 查詢 transitions
test_query "查詢所有 transitions" \
    '{"query":"{ transitions(limit: 10) { id e sm transition fst tst } }"}' \
    '"transitions"'

# 以狀態查詢 transitions
test_query "以 tst 查詢 transitions" \
    '{"query":"{ transitions(tst: \"INIT\", limit: 5) { id transition tst } }"}' \
    '"tst":"INIT"'

echo ""
echo "=== 4. 統計查詢測試 ==="

# 查詢 devices
test_query "查詢 devices 列表" \
    '{"query":"{ devices }"}' \
    '"devices"'

# 查詢 state machines
test_query "查詢 stateMachines" \
    '{"query":"{ stateMachines(deviceId: \"test-device-001\") }"}' \
    '"stateMachines"'

# trigger 計數
test_query "trigger 計數" \
    '{"query":"{ triggerCount(deviceId: \"test-device-001\") }"}' \
    '"triggerCount"'

# transition 計數
test_query "transition 計數" \
    '{"query":"{ transitionCount(deviceId: \"test-device-001\") }"}' \
    '"transitionCount"'

echo ""
echo "=== 5. 刪除測試 ==="

# 刪除 device 的 triggers
test_query "刪除 device triggers" \
    '{"query":"mutation { deleteTriggersByDevice(deviceId: \"test-device-001\") }"}' \
    '"deleteTriggersByDevice"'

# 刪除 device 的 transitions
test_query "刪除 device transitions" \
    '{"query":"mutation { deleteTransitionsByDevice(deviceId: \"test-device-001\") }"}' \
    '"deleteTransitionsByDevice"'

# 確認刪除成功
test_query "確認資料已刪除" \
    '{"query":"{ triggerCount(deviceId: \"test-device-001\") transitionCount(deviceId: \"test-device-001\") }"}' \
    '"triggerCount":0'

echo ""
echo "========================================"
echo "測試結果: ${GREEN}${PASS} 通過${NC}, ${RED}${FAIL} 失敗${NC}"
echo "========================================"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ 所有測試通過！${NC}"
    exit 0
else
    echo -e "${RED}❌ 有測試失敗${NC}"
    exit 1
fi
