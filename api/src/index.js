import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import mongoose from 'mongoose';

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebus';

await mongoose.connect(MONGODB_URI);
console.log('✅ Connected to MongoDB');

// Mongoose Schemas
const triggerSchema = new mongoose.Schema({
  timestamp: { type: Number, required: true, index: true },
  e: { type: String, required: true },
  arg: { type: mongoose.Schema.Types.Mixed, default: {} },
  s: String,
  can: Number, // 當時是否可進行狀態轉換
  sm: { type: String, required: true, index: true },
  trigger: { type: String, required: true },
  st: String,
  deviceId: { type: String, index: true }
}, { collection: 'triggers' });

const transitionSchema = new mongoose.Schema({
  timestamp: { type: Number, required: true, index: true },
  e: { type: String, required: true },
  arg: { type: mongoose.Schema.Types.Mixed, default: {} },
  sm: { type: String, required: true, index: true },
  transition: { type: String, required: true },
  fst: String,
  tst: String,
  deviceId: { type: String, index: true }
}, { collection: 'transitions' });

// Shop schema - 店鋪資訊
const shopSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },  // 店號，如 'vm01'
  name: { type: String, required: true },              // 中文名稱
  storerDeviceId: { type: String, default: '' },       // 存餐機 device id（可空）
  retrieverDeviceId: { type: String, default: '' }     // 取餐機 device id（可空）
}, { collection: 'shops' });

// Device schema - 設備資訊
const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }   // device id
}, { collection: 'devices' });

const Trigger = mongoose.model('Trigger', triggerSchema);
const Transition = mongoose.model('Transition', transitionSchema);
const Shop = mongoose.model('Shop', shopSchema);
const Device = mongoose.model('Device', deviceSchema);

// 從 DB 載入店鋪設備對應表（快取）
let STORE_DEVICES = {};

async function loadStoreDevices() {
  const shops = await Shop.find({});
  STORE_DEVICES = {};
  for (const shop of shops) {
    STORE_DEVICES[shop.id] = {
      storer: shop.storerDeviceId,
      retriever: shop.retrieverDeviceId
    };
  }
  console.log(`✅ Loaded ${shops.length} shops from database`);
}

// 初始載入
await loadStoreDevices();

// Cabin Status Bitwise Flags
const CABIN_FLAGS = {
  FRONT_DOOR_OPEN: { bit: 0, value: 1, name: '前門開啟' },
  BACK_DOOR_OPEN:  { bit: 1, value: 2, name: '後門開啟' },
  TOF_EMPTY:       { bit: 2, value: 4, name: 'ToF無物品' },
  UV_LIGHT_ON:     { bit: 3, value: 8, name: '殺菌燈亮' },
  FAULT:           { bit: 7, value: 128, name: '故障' }
};

// 要屏蔽的狀態 flag（不顯示在時間軸）
const HIDDEN_FLAGS = ['後門開啟', '故障'];

// 解析 cabin_status 變化，回傳人類可讀的描述
function parseCabinStatusChange(oldStatus, newStatus) {
  const changes = [];
  
  for (const [key, flag] of Object.entries(CABIN_FLAGS)) {
    // 跳過屏蔽的狀態
    if (HIDDEN_FLAGS.includes(flag.name)) continue;
    
    const wasSet = (oldStatus & flag.value) !== 0;
    const isSet = (newStatus & flag.value) !== 0;
    
    if (wasSet !== isSet) {
      let desc;
      if (flag.name === 'ToF無物品') {
        desc = isSet ? '感測無物' : '感測有物';
      } else if (flag.name === '前門開啟') {
        desc = isSet ? '前門開啟' : '前門關閉';
      } else if (flag.name === '殺菌燈亮') {
        desc = isSet ? '殺菌燈亮' : '殺菌燈滅';
      } else {
        desc = isSet ? flag.name : `非${flag.name}`;
      }
      
      changes.push({ flag: flag.name, from: wasSet, to: isSet, desc });
    }
  }
  
  return changes;
}

// 產生 cabin_status 變化的摘要文字
function cabinStatusSummary(oldStatus, newStatus) {
  const changes = parseCabinStatusChange(oldStatus, newStatus);
  if (changes.length === 0) return '無變化';
  return changes.map(c => c.desc).join(', ');
}

// GraphQL Schema
const typeDefs = `#graphql
  scalar JSON

  type Trigger {
    id: ID!
    timestamp: Float!
    e: String!
    arg: JSON
    s: String
    can: Int
    sm: String!
    trigger: String!
    st: String
    deviceId: String
  }

  type Transition {
    id: ID!
    timestamp: Float!
    e: String!
    arg: JSON
    sm: String!
    transition: String!
    fst: String
    tst: String
    deviceId: String
  }

  type Query {
    # Triggers
    triggers(
      deviceId: String
      sm: String
      trigger: String
      fromTimestamp: Float
      toTimestamp: Float
      limit: Int
      offset: Int
    ): [Trigger!]!
    
    trigger(id: ID!): Trigger
    
    triggerCount(deviceId: String, sm: String): Int!

    # Transitions
    transitions(
      deviceId: String
      sm: String
      transition: String
      fst: String
      tst: String
      fromTimestamp: Float
      toTimestamp: Float
      limit: Int
      offset: Int
    ): [Transition!]!
    
    transition(id: ID!): Transition
    
    transitionCount(deviceId: String, sm: String): Int!

    # Aggregations
    stateMachines(deviceId: String): [String!]!
    devices: [String!]!

    # Order List (訂單清單查詢)
    orderList(
      storeId: String
      orderId: String
      token: String
      chid: String
      fromTimestamp: Float
      toTimestamp: Float
      limit: Int
    ): [OrderSummary!]!
    
    # 取得店號清單
    stores: [StoreInfo!]!

    # Order Timeline (訂單詳情時間軸)
    orderTimeline(
      orderId: String!
    ): [OrderTimeline!]!

    # System Logs (系統日誌)
    systemLogs(
      storeId: String
      chid: String
      fromTimestamp: Float
      toTimestamp: Float
      limit: Int
    ): [SystemLog!]!

    # Admin: 店鋪管理
    allShops: [Shop!]!
    shop(id: String!): Shop

    # Admin: 設備管理
    allDevices: [Device!]!
    device(id: String!): Device
  }

  type SystemLog {
    timestamp: Float!
    level: String!
    event: String!
    message: String
    deviceId: String
    storeId: String
    deviceType: String
    chid: String
  }

  # Admin Types
  type Shop {
    id: String!
    name: String!
    storerDeviceId: String
    retrieverDeviceId: String
  }

  type Device {
    id: String!
  }

  type OrderSummary {
    orderId: String!
    storeId: String
    token: String
    chid: String
    storeTime: Float
    dispenseTime: Float
    isComplete: Boolean!
  }
  
  type StoreInfo {
    storeId: String!
    name: String!
    storerDeviceId: String!
    retrieverDeviceId: String!
  }

  type OrderTimeline {
    orderId: String!
    token: String
    chid: String
    events: [OrderEvent!]!
  }

  type OrderEvent {
    timestamp: Float!
    e: String!
    arg: JSON
    sm: String!
    trigger: String!
    st: String
    deviceId: String
  }

  input TriggerInput {
    timestamp: Float!
    e: String!
    arg: JSON
    s: String
    can: Int
    sm: String!
    trigger: String!
    st: String
    deviceId: String
  }

  input TransitionInput {
    timestamp: Float!
    e: String!
    arg: JSON
    sm: String!
    transition: String!
    fst: String
    tst: String
    deviceId: String
  }

  input ShopInput {
    id: String!
    name: String!
    storerDeviceId: String
    retrieverDeviceId: String
  }

  input DeviceInput {
    id: String!
  }

  type Mutation {
    # Triggers
    createTrigger(input: TriggerInput!): Trigger!
    createTriggers(inputs: [TriggerInput!]!): [Trigger!]!
    deleteTrigger(id: ID!): Boolean!
    deleteTriggersByDevice(deviceId: String!): Int!

    # Transitions
    createTransition(input: TransitionInput!): Transition!
    createTransitions(inputs: [TransitionInput!]!): [Transition!]!
    deleteTransition(id: ID!): Boolean!
    deleteTransitionsByDevice(deviceId: String!): Int!

    # Admin: 店鋪管理
    createShop(input: ShopInput!): Shop!
    updateShop(id: String!, input: ShopInput!): Shop
    deleteShop(id: String!): Boolean!

    # Admin: 設備管理
    createDevice(input: DeviceInput!): Device!
    deleteDevice(id: String!): Boolean!

    # 重新載入店鋪快取
    reloadShops: Boolean!
  }
`;

import { GraphQLScalarType, Kind } from 'graphql';

// Custom JSON scalar
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON scalar type',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
        return JSON.parse(ast.value);
      case Kind.OBJECT:
        return parseObject(ast);
      case Kind.LIST:
        return ast.values.map(v => JSONScalar.parseLiteral(v));
      case Kind.INT:
        return parseInt(ast.value, 10);
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.NULL:
        return null;
      default:
        return null;
    }
  },
});

function parseObject(ast) {
  const obj = {};
  ast.fields.forEach(field => {
    obj[field.name.value] = JSONScalar.parseLiteral(field.value);
  });
  return obj;
}

// 根據 deviceId 反查店號
function getStoreId(deviceId) {
  for (const [storeId, devices] of Object.entries(STORE_DEVICES)) {
    if (devices.storer === deviceId || devices.retriever === deviceId) {
      return storeId;
    }
  }
  return null;
}

// 根據 deviceId 反查設備類型
function getDeviceType(deviceId) {
  for (const [storeId, devices] of Object.entries(STORE_DEVICES)) {
    if (devices.storer === deviceId) return '存餐機';
    if (devices.retriever === deviceId) return '取餐機';
  }
  return null;
}

// Resolvers
const resolvers = {
  JSON: JSONScalar,

  Trigger: {
    id: (parent) => parent._id.toString(),
    arg: (parent) => parent.arg || {},
  },

  Transition: {
    id: (parent) => parent._id.toString(),
    arg: (parent) => parent.arg || {},
  },

  Query: {
    // Triggers
    triggers: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      if (args.trigger) query.trigger = args.trigger;
      if (args.fromTimestamp || args.toTimestamp) {
        query.timestamp = {};
        if (args.fromTimestamp) query.timestamp.$gte = args.fromTimestamp;
        if (args.toTimestamp) query.timestamp.$lte = args.toTimestamp;
      }
      
      return Trigger.find(query)
        .sort({ timestamp: -1 })
        .skip(args.offset || 0)
        .limit(args.limit || 100);
    },

    trigger: async (_, { id }) => Trigger.findById(id),
    
    triggerCount: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      return Trigger.countDocuments(query);
    },

    // Transitions
    transitions: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      if (args.transition) query.transition = args.transition;
      if (args.fst) query.fst = args.fst;
      if (args.tst) query.tst = args.tst;
      if (args.fromTimestamp || args.toTimestamp) {
        query.timestamp = {};
        if (args.fromTimestamp) query.timestamp.$gte = args.fromTimestamp;
        if (args.toTimestamp) query.timestamp.$lte = args.toTimestamp;
      }
      
      return Transition.find(query)
        .sort({ timestamp: -1 })
        .skip(args.offset || 0)
        .limit(args.limit || 100);
    },

    transition: async (_, { id }) => Transition.findById(id),
    
    transitionCount: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      return Transition.countDocuments(query);
    },

    // Aggregations
    stateMachines: async (_, args) => {
      const match = args.deviceId ? { deviceId: args.deviceId } : {};
      const result = await Trigger.distinct('sm', match);
      return result;
    },

    devices: async () => {
      const triggers = await Trigger.distinct('deviceId');
      const transitions = await Transition.distinct('deviceId');
      return [...new Set([...triggers, ...transitions])].filter(Boolean);
    },

    // 店號清單（從 DB 讀取）
    stores: async () => {
      const shops = await Shop.find({});
      return shops.map(shop => ({
        storeId: shop.id,
        name: shop.name,
        storerDeviceId: shop.storerDeviceId,
        retrieverDeviceId: shop.retrieverDeviceId
      }));
    },

    // Order List - 訂單清單查詢
    orderList: async (_, args) => {
      const limit = args.limit || 100;
      
      // 建立查詢條件
      const query = {
        e: 'store/store_ok',
        'arg.oid': { $exists: true, $type: 'string' }
      };
      
      // ⚠️ orderId 是 Mandatory 特性：有提供就不參考其他過濾器
      if (args.orderId) {
        query['arg.oid'] = args.orderId;
      } else {
        // 其餘過濾器採用交集（AND）方式
        
        // 店號篩選 - 只查該店的存餐機
        if (args.storeId && STORE_DEVICES[args.storeId]) {
          query.deviceId = STORE_DEVICES[args.storeId].storer;
        }
        
        // 時間範圍
        if (args.fromTimestamp || args.toTimestamp) {
          query.timestamp = {};
          if (args.fromTimestamp) query.timestamp.$gte = args.fromTimestamp;
          if (args.toTimestamp) query.timestamp.$lte = args.toTimestamp;
        }
        
        // 指定 token
        if (args.token) {
          query['arg.token'] = args.token;
        }
        
        // 指定格口
        if (args.chid) {
          query['arg.chid'] = args.chid;
        }
      }
      
      // 查詢存餐事件
      const storeEvents = await Trigger.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
      
      const results = [];
      
      for (const store of storeEvents) {
        const oid = store.arg.oid;
        
        // 查詢取餐事件
        const dispenseEvent = await Trigger.findOne({
          'arg.oid': oid,
          e: 'dispense/prod_dispensed'
        });
        
        results.push({
          orderId: oid,
          storeId: getStoreId(store.deviceId),
          token: store.arg.token,
          chid: store.arg.chid?.[0],
          storeTime: store.timestamp,
          dispenseTime: dispenseEvent?.timestamp || null,
          isComplete: !!dispenseEvent
        });
      }
      
      return results;
    },

    // Order Timeline - 訂單詳情時間軸
    orderTimeline: async (_, args) => {
      if (!args.orderId) return [];
      
      const events = await Trigger.find({
        'arg.oid': args.orderId
      }).sort({ timestamp: 1 });

      if (events.length === 0) return [];

      const storeEvent = events.find(e => e.e === 'store/store_ok');
      const dispenseReadyEvent = events.find(e => e.e === 'dispense/ready');
      const token = storeEvent?.arg?.token;
      const chid = storeEvent?.arg?.chid?.[0];

      // 轉換 trigger 事件為時間軸事件
      let timelineEvents = events.map(e => ({
        timestamp: e.timestamp,
        e: e.e,
        arg: e.arg,
        sm: e.sm,
        trigger: e.trigger,
        st: e.st,
        deviceId: e.deviceId
      }));

      // 查詢存餐掃碼事件 (store/store_ok 前 10 秒內的 reader/read)
      if (storeEvent) {
        const storeReaderEvents = await Trigger.find({
          deviceId: storeEvent.deviceId,
          e: 'reader/read',
          timestamp: { 
            $gte: storeEvent.timestamp - 10 * 1000000,
            $lte: storeEvent.timestamp 
          }
        }).sort({ timestamp: 1 });
        
        for (const evt of storeReaderEvents) {
          timelineEvents.push({
            timestamp: evt.timestamp,
            e: evt.e,
            arg: evt.arg,
            sm: evt.sm,
            trigger: evt.trigger,
            st: evt.st,
            deviceId: evt.deviceId
          });
        }
      }

      // 查詢取餐掃碼和認證事件 (dispense/ready 前 5 秒內)
      if (dispenseReadyEvent) {
        const dispenseReaderEvents = await Trigger.find({
          deviceId: dispenseReadyEvent.deviceId,
          e: { $in: ['reader/read', 'auth/auth_ok'] },
          timestamp: { 
            $gte: dispenseReadyEvent.timestamp - 5 * 1000000,
            $lte: dispenseReadyEvent.timestamp 
          }
        }).sort({ timestamp: 1 });
        
        for (const evt of dispenseReaderEvents) {
          timelineEvents.push({
            timestamp: evt.timestamp,
            e: evt.e,
            arg: evt.arg,
            sm: evt.sm,
            trigger: evt.trigger,
            st: evt.st,
            deviceId: evt.deviceId
          });
        }
      }

      // 先排序一次
      timelineEvents.sort((a, b) => a.timestamp - b.timestamp);

      // 查詢格口狀態變化
      if (storeEvent && chid) {
        const cabinId = chid.toString().padStart(2, '0'); // 格口號補零，如 '7' -> '07'
        
        // 找結束事件：取餐完成 or 訂單刪除
        const dispenseEvent = events.find(e => e.e === 'dispense/prod_dispensed');
        const disposeEvent = events.find(e => e.e === 'dispose/dispose_ok');
        const endEvent = dispenseEvent || disposeEvent;
        
        let fromTs, toTs;
        
        if (endEvent) {
          // 已取餐或已刪除：從存餐前30秒到結束事件後30秒
          fromTs = storeEvent.timestamp - 30 * 1000000; // 存餐前 30 秒
          toTs = endEvent.timestamp + 30 * 1000000; // 結束後 30 秒
        } else {
          // 尚未取餐：從存餐前30秒到現在
          fromTs = storeEvent.timestamp - 30 * 1000000; // 存餐前 30 秒
          toTs = Date.now() * 1000; // 現在時間（轉微秒）
        }
        
        // 查詢該格口的 cabin_status 變化
        const cabinStatusQuery = {
          'arg.cabin_status': { $exists: true },
          timestamp: { $gte: fromTs, $lte: toTs }
        };
        
        const cabinStatusEvents = await Transition.find(cabinStatusQuery).sort({ timestamp: 1 });
        
        // 篩選出該格口的狀態變化並加入時間軸（只取 before_hint，避免重複）
        for (const csEvent of cabinStatusEvents) {
          if (csEvent.transition !== 'before_hint') continue; // 只取 before_hint
          
          const cabinStatus = csEvent.arg?.cabin_status;
          if (cabinStatus && cabinStatus[cabinId]) {
            const [oldStatus, newStatus] = cabinStatus[cabinId];
            const summary = cabinStatusSummary(oldStatus, newStatus);
            
            // 如果只有被屏蔽的狀態變化，就不加入時間軸
            if (summary === '無變化') continue;
            
            timelineEvents.push({
              timestamp: csEvent.timestamp,
              e: `cabin/${cabinId}`,
              arg: {
                old: oldStatus,
                new: newStatus,
                changes: summary
              },
              sm: 'cabin',
              trigger: 'status_change',
              st: null,
              deviceId: null // 格口事件不屬於特定設備
            });
          }
        }
        
        // 重新按時間排序
        timelineEvents.sort((a, b) => a.timestamp - b.timestamp);
      }

      return [{
        orderId: args.orderId,
        token,
        chid,
        events: timelineEvents
      }];
    },

    // Admin: 店鋪查詢
    allShops: async () => Shop.find({}).sort({ id: 1 }),
    shop: async (_, { id }) => Shop.findOne({ id }),

    // Admin: 設備查詢
    allDevices: async () => Device.find({}).sort({ id: 1 }),
    device: async (_, { id }) => Device.findOne({ id }),

    // System Logs - 系統日誌查詢
    systemLogs: async (_, args) => {
      const limit = args.limit || 200;
      const logs = [];
      
      // 建立時間範圍查詢
      const timeQuery = {};
      if (args.fromTimestamp) timeQuery.$gte = args.fromTimestamp;
      if (args.toTimestamp) timeQuery.$lte = args.toTimestamp;
      
      // 建立設備篩選
      let deviceIds = null;
      if (args.storeId && STORE_DEVICES[args.storeId]) {
        deviceIds = [
          STORE_DEVICES[args.storeId].storer,
          STORE_DEVICES[args.storeId].retriever
        ].filter(Boolean);
      }
      
      // 格口號補零
      const cabinId = args.chid ? args.chid.toString().padStart(2, '0') : null;
      
      // 1. 查詢格口故障事件 (cabin_status 包含 128)
      const faultQuery = {
        'arg.cabin_status': { $exists: true },
        transition: 'before_hint'
      };
      if (Object.keys(timeQuery).length > 0) faultQuery.timestamp = timeQuery;
      if (deviceIds) faultQuery.deviceId = { $in: deviceIds };
      
      const faultEvents = await Transition.find(faultQuery).sort({ timestamp: -1 }).limit(500);
      for (const evt of faultEvents) {
        const cabinStatus = evt.arg?.cabin_status || {};
        for (const [cid, values] of Object.entries(cabinStatus)) {
          if (cabinId && cid !== cabinId) continue; // 格口篩選
          
          const [oldVal, newVal] = values;
          // 檢查是否進入故障狀態 (bit 7 = 128)
          const wasFault = (oldVal & 128) !== 0;
          const isFault = (newVal & 128) !== 0;
          
          if (!wasFault && isFault) {
            logs.push({
              timestamp: evt.timestamp,
              level: 'error',
              event: '格口故障',
              message: `格口 ${cid} 進入故障狀態`,
              deviceId: evt.deviceId,
              storeId: getStoreId(evt.deviceId),
              deviceType: '格口',
              chid: cid
            });
          } else if (wasFault && !isFault) {
            logs.push({
              timestamp: evt.timestamp,
              level: 'success',
              event: '故障恢復',
              message: `格口 ${cid} 故障已恢復`,
              deviceId: evt.deviceId,
              storeId: getStoreId(evt.deviceId),
              deviceType: '格口',
              chid: cid
            });
          }
        }
      }
      
      // 3. 查詢訂單刪除（可能是餐點過期）
      const disposeQuery = {
        e: 'dispose/dispose_ok'
      };
      if (Object.keys(timeQuery).length > 0) disposeQuery.timestamp = timeQuery;
      if (deviceIds) disposeQuery.deviceId = { $in: deviceIds };
      
      const disposeEvents = await Trigger.find(disposeQuery).sort({ timestamp: -1 }).limit(50);
      for (const evt of disposeEvents) {
        const chidVal = evt.arg?.chid?.[0];
        if (cabinId && chidVal?.toString().padStart(2, '0') !== cabinId) continue;
        
        logs.push({
          timestamp: evt.timestamp,
          level: 'warn',
          event: '訂單刪除',
          message: `格口 ${chidVal} 訂單已刪除`,
          deviceId: evt.deviceId,
          storeId: getStoreId(evt.deviceId),
          deviceType: getDeviceType(evt.deviceId),
          chid: chidVal?.toString().padStart(2, '0')
        });
      }
      
      // 4. 查詢互動閒置 (sess/timeout)
      const timeoutQuery = {
        e: 'sess/timeout'
      };
      if (Object.keys(timeQuery).length > 0) timeoutQuery.timestamp = timeQuery;
      if (deviceIds) timeoutQuery.deviceId = { $in: deviceIds };
      
      const timeoutEvents = await Trigger.find(timeoutQuery).sort({ timestamp: -1 }).limit(50);
      for (const evt of timeoutEvents) {
        logs.push({
          timestamp: evt.timestamp,
          level: 'info',
          event: '互動閒置',
          message: null,
          deviceId: evt.deviceId,
          storeId: getStoreId(evt.deviceId),
          deviceType: getDeviceType(evt.deviceId),
          chid: null
        });
      }
      
      // 5. 查詢互動開始 (sess/session_begin)
      const sessionBeginQuery = {
        e: 'sess/session_begin'
      };
      if (Object.keys(timeQuery).length > 0) sessionBeginQuery.timestamp = timeQuery;
      if (deviceIds) sessionBeginQuery.deviceId = { $in: deviceIds };
      
      const sessionBeginEvents = await Trigger.find(sessionBeginQuery).sort({ timestamp: -1 }).limit(50);
      for (const evt of sessionBeginEvents) {
        logs.push({
          timestamp: evt.timestamp,
          level: 'info',
          event: '互動開始',
          message: null,
          deviceId: evt.deviceId,
          storeId: getStoreId(evt.deviceId),
          deviceType: getDeviceType(evt.deviceId),
          chid: null
        });
      }
      
      // 6. 查詢開機完成 (sys/sys_op)
      const sysOpQuery = {
        e: 'sys/sys_op'
      };
      if (Object.keys(timeQuery).length > 0) sysOpQuery.timestamp = timeQuery;
      if (deviceIds) sysOpQuery.deviceId = { $in: deviceIds };
      
      const sysOpEvents = await Trigger.find(sysOpQuery).sort({ timestamp: -1 }).limit(50);
      for (const evt of sysOpEvents) {
        logs.push({
          timestamp: evt.timestamp,
          level: 'success',
          event: '開機完成',
          message: null,
          deviceId: evt.deviceId,
          storeId: getStoreId(evt.deviceId),
          deviceType: getDeviceType(evt.deviceId),
          chid: null
        });
      }
      
      // 按時間排序並限制數量
      logs.sort((a, b) => b.timestamp - a.timestamp);
      return logs.slice(0, limit);
    },
  },

  Mutation: {
    // Triggers
    createTrigger: async (_, { input }) => {
      const trigger = new Trigger(input);
      return trigger.save();
    },

    createTriggers: async (_, { inputs }) => {
      return Trigger.insertMany(inputs);
    },

    deleteTrigger: async (_, { id }) => {
      const result = await Trigger.findByIdAndDelete(id);
      return !!result;
    },

    deleteTriggersByDevice: async (_, { deviceId }) => {
      const result = await Trigger.deleteMany({ deviceId });
      return result.deletedCount;
    },

    // Transitions
    createTransition: async (_, { input }) => {
      const transition = new Transition(input);
      return transition.save();
    },

    createTransitions: async (_, { inputs }) => {
      return Transition.insertMany(inputs);
    },

    deleteTransition: async (_, { id }) => {
      const result = await Transition.findByIdAndDelete(id);
      return !!result;
    },

    deleteTransitionsByDevice: async (_, { deviceId }) => {
      const result = await Transition.deleteMany({ deviceId });
      return result.deletedCount;
    },

    // Admin: 店鋪管理
    createShop: async (_, { input }) => {
      // 正規化空值
      input.storerDeviceId = input.storerDeviceId || '';
      input.retrieverDeviceId = input.retrieverDeviceId || '';
      
      // 檢查存餐機和取餐機不能用同一個設備
      if (input.storerDeviceId && input.retrieverDeviceId && input.storerDeviceId === input.retrieverDeviceId) {
        throw new Error(`存餐機和取餐機不能使用同一個設備`);
      }
      
      // 檢查設備是否已被其他店鋪使用（只在有值時檢查）
      if (input.storerDeviceId) {
        const existingStorer = await Shop.findOne({ storerDeviceId: input.storerDeviceId });
        if (existingStorer) {
          throw new Error(`存餐機 ${input.storerDeviceId} 已被店鋪 ${existingStorer.id} 使用`);
        }
        const usedAsRetriever = await Shop.findOne({ retrieverDeviceId: input.storerDeviceId });
        if (usedAsRetriever) {
          throw new Error(`設備 ${input.storerDeviceId} 已被店鋪 ${usedAsRetriever.id} 作為取餐機使用`);
        }
      }
      if (input.retrieverDeviceId) {
        const existingRetriever = await Shop.findOne({ retrieverDeviceId: input.retrieverDeviceId });
        if (existingRetriever) {
          throw new Error(`取餐機 ${input.retrieverDeviceId} 已被店鋪 ${existingRetriever.id} 使用`);
        }
        const usedAsStorer = await Shop.findOne({ storerDeviceId: input.retrieverDeviceId });
        if (usedAsStorer) {
          throw new Error(`設備 ${input.retrieverDeviceId} 已被店鋪 ${usedAsStorer.id} 作為存餐機使用`);
        }
      }
      
      const shop = new Shop(input);
      await shop.save();
      await loadStoreDevices();
      return shop;
    },

    updateShop: async (_, { id, input }) => {
      // 正規化空值
      input.storerDeviceId = input.storerDeviceId || '';
      input.retrieverDeviceId = input.retrieverDeviceId || '';
      
      // 檢查存餐機和取餐機不能用同一個設備
      if (input.storerDeviceId && input.retrieverDeviceId && input.storerDeviceId === input.retrieverDeviceId) {
        throw new Error(`存餐機和取餐機不能使用同一個設備`);
      }
      
      // 檢查設備是否已被其他店鋪使用（只在有值時檢查，排除自己）
      if (input.storerDeviceId) {
        const existingStorer = await Shop.findOne({ 
          storerDeviceId: input.storerDeviceId,
          id: { $ne: id }
        });
        if (existingStorer) {
          throw new Error(`存餐機 ${input.storerDeviceId} 已被店鋪 ${existingStorer.id} 使用`);
        }
        const usedAsRetriever = await Shop.findOne({ 
          retrieverDeviceId: input.storerDeviceId,
          id: { $ne: id }
        });
        if (usedAsRetriever) {
          throw new Error(`設備 ${input.storerDeviceId} 已被店鋪 ${usedAsRetriever.id} 作為取餐機使用`);
        }
      }
      if (input.retrieverDeviceId) {
        const existingRetriever = await Shop.findOne({ 
          retrieverDeviceId: input.retrieverDeviceId,
          id: { $ne: id }
        });
        if (existingRetriever) {
          throw new Error(`取餐機 ${input.retrieverDeviceId} 已被店鋪 ${existingRetriever.id} 使用`);
        }
        const usedAsStorer = await Shop.findOne({ 
          storerDeviceId: input.retrieverDeviceId,
          id: { $ne: id }
        });
        if (usedAsStorer) {
          throw new Error(`設備 ${input.retrieverDeviceId} 已被店鋪 ${usedAsStorer.id} 作為存餐機使用`);
        }
      }
      
      const shop = await Shop.findOneAndUpdate({ id }, input, { new: true });
      await loadStoreDevices();
      return shop;
    },

    deleteShop: async (_, { id }) => {
      const result = await Shop.deleteOne({ id });
      await loadStoreDevices();
      return result.deletedCount > 0;
    },

    // Admin: 設備管理
    createDevice: async (_, { input }) => {
      const device = new Device(input);
      return device.save();
    },

    deleteDevice: async (_, { id }) => {
      // 檢查設備是否被使用中
      const usedAsStorer = await Shop.findOne({ storerDeviceId: id });
      if (usedAsStorer) {
        throw new Error(`設備 ${id} 被店鋪 ${usedAsStorer.id} 作為存餐機使用中，無法刪除`);
      }
      const usedAsRetriever = await Shop.findOne({ retrieverDeviceId: id });
      if (usedAsRetriever) {
        throw new Error(`設備 ${id} 被店鋪 ${usedAsRetriever.id} 作為取餐機使用中，無法刪除`);
      }
      
      const result = await Device.deleteOne({ id });
      return result.deletedCount > 0;
    },

    // 重新載入店鋪快取
    reloadShops: async () => {
      await loadStoreDevices();
      return true;
    },
  },
};

// Start server
const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: parseInt(process.env.PORT) || 4000 },
});

console.log(`🚀 GraphQL API ready at ${url}`);
