import { Trigger, Transition, STORE_DEVICES, getStoreId, getDeviceType, cabinStatusSummary } from './common.js';

export const typeDefs = `#graphql
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
`;

export const resolvers = {
  Query: {
    stores: async () => {
      const { Shop } = await import('./common.js');
      const shops = await Shop.find({});
      return shops.map(shop => ({
        storeId: shop.id,
        name: shop.name,
        storerDeviceId: shop.storerDeviceId,
        retrieverDeviceId: shop.retrieverDeviceId
      }));
    },

    orderList: async (_, args) => {
      const limit = args.limit || 100;
      const query = {
        e: 'store/store_ok',
        'arg.oid': { $exists: true, $type: 'string' }
      };
      if (args.orderId) {
        query['arg.oid'] = args.orderId;
      } else {
        if (args.storeId && STORE_DEVICES[args.storeId]) {
          query.deviceId = STORE_DEVICES[args.storeId].storer;
        }
        if (args.fromTimestamp || args.toTimestamp) {
          query.timestamp = {};
          if (args.fromTimestamp) query.timestamp.$gte = args.fromTimestamp;
          if (args.toTimestamp) query.timestamp.$lte = args.toTimestamp;
        }
        if (args.token) query['arg.token'] = args.token;
        if (args.chid) query['arg.chid'] = args.chid;
      }

      const storeEvents = await Trigger.find(query).sort({ timestamp: -1 }).limit(limit);
      const results = [];

      for (const store of storeEvents) {
        const oid = store.arg.oid;
        const dispenseEvent = await Trigger.findOne({ 'arg.oid': oid, e: 'dispense/prod_dispensed' });
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

    orderTimeline: async (_, args) => {
      if (!args.orderId) return [];
      const events = await Trigger.find({ 'arg.oid': args.orderId }).sort({ timestamp: 1 });
      if (events.length === 0) return [];

      const storeEvent = events.find(e => e.e === 'store/store_ok');
      const dispenseReadyEvent = events.find(e => e.e === 'dispense/ready');
      const token = storeEvent?.arg?.token;
      const chid = storeEvent?.arg?.chid?.[0];

      let timelineEvents = events.map(e => ({
        timestamp: e.timestamp, e: e.e, arg: e.arg, sm: e.sm, trigger: e.trigger, st: e.st, deviceId: e.deviceId
      }));

      // 存餐掃碼事件
      if (storeEvent) {
        const readerEvents = await Trigger.find({
          deviceId: storeEvent.deviceId, e: 'reader/read',
          timestamp: { $gte: storeEvent.timestamp - 10 * 1000000, $lte: storeEvent.timestamp }
        }).sort({ timestamp: 1 });
        for (const evt of readerEvents) {
          timelineEvents.push({ timestamp: evt.timestamp, e: evt.e, arg: evt.arg, sm: evt.sm, trigger: evt.trigger, st: evt.st, deviceId: evt.deviceId });
        }
      }

      // 取餐掃碼和認證事件
      if (dispenseReadyEvent) {
        const readerEvents = await Trigger.find({
          deviceId: dispenseReadyEvent.deviceId,
          e: { $in: ['reader/read', 'auth/auth_ok'] },
          timestamp: { $gte: dispenseReadyEvent.timestamp - 5 * 1000000, $lte: dispenseReadyEvent.timestamp }
        }).sort({ timestamp: 1 });
        for (const evt of readerEvents) {
          timelineEvents.push({ timestamp: evt.timestamp, e: evt.e, arg: evt.arg, sm: evt.sm, trigger: evt.trigger, st: evt.st, deviceId: evt.deviceId });
        }
      }

      timelineEvents.sort((a, b) => a.timestamp - b.timestamp);

      // 格口狀態變化
      if (storeEvent && chid) {
        const cabinId = chid.toString().padStart(2, '0');
        const dispenseEvent = events.find(e => e.e === 'dispense/prod_dispensed');
        const disposeEvent = events.find(e => e.e === 'dispose/dispose_ok');
        const endEvent = dispenseEvent || disposeEvent;
        const fromTs = storeEvent.timestamp - 30 * 1000000;
        const toTs = endEvent ? endEvent.timestamp + 30 * 1000000 : Date.now() * 1000;

        const cabinStatusEvents = await Transition.find({
          'arg.cabin_status': { $exists: true },
          transition: 'before_hint',
          timestamp: { $gte: fromTs, $lte: toTs }
        }).sort({ timestamp: 1 });

        for (const csEvent of cabinStatusEvents) {
          const cabinStatus = csEvent.arg?.cabin_status;
          if (cabinStatus && cabinStatus[cabinId]) {
            const [oldStatus, newStatus] = cabinStatus[cabinId];
            const summary = cabinStatusSummary(oldStatus, newStatus);
            if (summary === '無變化') continue;
            timelineEvents.push({
              timestamp: csEvent.timestamp, e: `cabin/${cabinId}`,
              arg: { old: oldStatus, new: newStatus, changes: summary },
              sm: 'cabin', trigger: 'status_change', st: null, deviceId: null
            });
          }
        }
        timelineEvents.sort((a, b) => a.timestamp - b.timestamp);
      }

      return [{ orderId: args.orderId, token, chid, events: timelineEvents }];
    },

    systemLogs: async (_, args) => {
      const limit = args.limit || 200;
      const logs = [];
      const timeQuery = {};
      if (args.fromTimestamp) timeQuery.$gte = args.fromTimestamp;
      if (args.toTimestamp) timeQuery.$lte = args.toTimestamp;

      let deviceIds = null;
      if (args.storeId && STORE_DEVICES[args.storeId]) {
        deviceIds = [STORE_DEVICES[args.storeId].storer, STORE_DEVICES[args.storeId].retriever].filter(Boolean);
      }
      const cabinId = args.chid ? args.chid.toString().padStart(2, '0') : null;

      // 格口故障
      const faultQuery = { 'arg.cabin_status': { $exists: true }, transition: 'before_hint' };
      if (Object.keys(timeQuery).length > 0) faultQuery.timestamp = timeQuery;
      if (deviceIds) faultQuery.deviceId = { $in: deviceIds };
      const faultEvents = await Transition.find(faultQuery).sort({ timestamp: -1 }).limit(500);
      for (const evt of faultEvents) {
        for (const [cid, values] of Object.entries(evt.arg?.cabin_status || {})) {
          if (cabinId && cid !== cabinId) continue;
          const [oldVal, newVal] = values;
          if (!(oldVal & 128) && (newVal & 128)) {
            logs.push({ timestamp: evt.timestamp, level: 'error', event: '格口故障', message: `格口 ${cid} 進入故障狀態`, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: '格口', chid: cid });
          } else if ((oldVal & 128) && !(newVal & 128)) {
            logs.push({ timestamp: evt.timestamp, level: 'success', event: '故障恢復', message: `格口 ${cid} 故障已恢復`, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: '格口', chid: cid });
          }
        }
      }

      // 訂單刪除
      const disposeQuery = { e: 'dispose/dispose_ok' };
      if (Object.keys(timeQuery).length > 0) disposeQuery.timestamp = timeQuery;
      if (deviceIds) disposeQuery.deviceId = { $in: deviceIds };
      for (const evt of await Trigger.find(disposeQuery).sort({ timestamp: -1 }).limit(50)) {
        const ch = evt.arg?.chid?.[0];
        if (cabinId && ch?.toString().padStart(2, '0') !== cabinId) continue;
        logs.push({ timestamp: evt.timestamp, level: 'warn', event: '訂單刪除', message: `格口 ${ch} 訂單已刪除`, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: getDeviceType(evt.deviceId), chid: ch?.toString().padStart(2, '0') });
      }

      // 互動閒置
      const timeoutQuery = { e: 'sess/timeout' };
      if (Object.keys(timeQuery).length > 0) timeoutQuery.timestamp = timeQuery;
      if (deviceIds) timeoutQuery.deviceId = { $in: deviceIds };
      for (const evt of await Trigger.find(timeoutQuery).sort({ timestamp: -1 }).limit(50)) {
        logs.push({ timestamp: evt.timestamp, level: 'info', event: '互動閒置', message: null, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: getDeviceType(evt.deviceId), chid: null });
      }

      // 互動開始
      const beginQuery = { e: 'sess/session_begin' };
      if (Object.keys(timeQuery).length > 0) beginQuery.timestamp = timeQuery;
      if (deviceIds) beginQuery.deviceId = { $in: deviceIds };
      for (const evt of await Trigger.find(beginQuery).sort({ timestamp: -1 }).limit(50)) {
        logs.push({ timestamp: evt.timestamp, level: 'info', event: '互動開始', message: null, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: getDeviceType(evt.deviceId), chid: null });
      }

      // 開機完成
      const sysOpQuery = { e: 'sys/sys_op' };
      if (Object.keys(timeQuery).length > 0) sysOpQuery.timestamp = timeQuery;
      if (deviceIds) sysOpQuery.deviceId = { $in: deviceIds };
      for (const evt of await Trigger.find(sysOpQuery).sort({ timestamp: -1 }).limit(50)) {
        logs.push({ timestamp: evt.timestamp, level: 'success', event: '開機完成', message: null, deviceId: evt.deviceId, storeId: getStoreId(evt.deviceId), deviceType: getDeviceType(evt.deviceId), chid: null });
      }

      logs.sort((a, b) => b.timestamp - a.timestamp);
      return logs.slice(0, limit);
    },
  },
};
