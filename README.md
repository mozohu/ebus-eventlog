# 麥味登客服查詢系統 (ebus-eventlog)

用於儲存與查詢 ebus 事件日誌（triggers 與 transitions）的 GraphQL API，含一線客服查詢介面。

## 快速啟動

```bash
# 啟動所有服務
docker compose up -d

# 檢查狀態
docker compose ps
```

## 服務列表

| 服務 | 網址 | 說明 |
|------|------|------|
| **客服查詢介面** | http://localhost:8080 | 一線客服查詢系統 |
| GraphQL API | http://localhost:4000 | Apollo Server（含 GraphQL Playground） |
| Mongo Express | http://localhost:8081 | MongoDB 網頁管理介面（admin/ebus2026） |
| MongoDB | localhost:27017 | 資料庫 |

## 客服查詢介面

一線客服可透過 http://localhost:8080 查詢訂單完整流程：

- **依 Order ID 查詢**：輸入訂單編號查詢完整存餐到取餐記錄
- **依取餐碼查詢**：輸入取餐碼（Token）查詢相關訂單
- **依日期範圍查詢**：查詢特定日期範圍內的訂單

查詢結果以時間軸呈現，清楚顯示：
- 存餐機（綠色）事件
- 取餐機（藍色）事件
- 各事件的時間、狀態、訊息

## GraphQL 範例

### 查詢 triggers
```graphql
query {
  triggers(deviceId: "0242ac1e0008", limit: 10) {
    id
    timestamp
    e
    sm
    trigger
    st
    arg
  }
}
```

### 查詢 transitions
```graphql
query {
  transitions(sm: "sys", limit: 10) {
    id
    timestamp
    transition
    fst
    tst
  }
}
```

### 新增單筆 trigger
```graphql
mutation {
  createTrigger(input: {
    timestamp: 1770454586034248
    e: "auth/goto_none"
    arg: {}
    s: "./auth.pl"
    can: 0
    sm: "auth"
    trigger: "goto_none"
    st: "none"
    deviceId: "0242ac1e0008"
  }) {
    id
    timestamp
    e
  }
}
```

### 批次新增 triggers
```graphql
mutation {
  createTriggers(inputs: [
    { timestamp: 1770454586034248, e: "auth/goto_none", sm: "auth", trigger: "goto_none", deviceId: "device1" },
    { timestamp: 1770454586034249, e: "sys/start", sm: "sys", trigger: "start", deviceId: "device1" }
  ]) {
    id
  }
}
```

### 統計資訊
```graphql
query {
  devices
  stateMachines(deviceId: "0242ac1e0008")
  triggerCount(deviceId: "0242ac1e0008")
  transitionCount(deviceId: "0242ac1e0008")
}
```

## 資料結構

### Trigger（事件觸發）
| 欄位 | 說明 |
|------|------|
| `timestamp` | 微秒級 Unix 時間戳 |
| `e` | 事件名稱（格式：sm/trigger） |
| `arg` | JSON 參數 |
| `s` | 來源腳本路徑 |
| `can` | 當時是否可進行狀態轉換（0/1） |
| `sm` | State Machine 名稱 |
| `trigger` | 觸發器名稱 |
| `st` | 當前狀態 |
| `deviceId` | 裝置識別碼 |

### Transition（狀態轉換）
| 欄位 | 說明 |
|------|------|
| `timestamp` | 微秒級 Unix 時間戳 |
| `e` | 事件名稱 |
| `arg` | JSON 參數 |
| `sm` | State Machine 名稱 |
| `transition` | 轉換名稱 |
| `fst` | 起始狀態（from state） |
| `tst` | 目標狀態（to state） |
| `deviceId` | 裝置識別碼 |

## 設定

複製 `.env.example` 為 `.env` 並設定密碼：

```bash
cp .env.example .env
# 編輯 .env 設定密碼
```

## 測試

執行測試腳本驗證服務是否正常：

```bash
./scripts/test.sh

# 或指定 API URL
./scripts/test.sh http://your-server:4000
```

## 從 SQLite 匯入

匯入現有的 SQLite 日誌：

```bash
cd scripts
npm install
node import-sqlite.js /path/to/ebus_log.sqlite <device-id>
```
