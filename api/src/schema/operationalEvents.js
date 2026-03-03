import mongoose from 'mongoose';

// 營運事件類型對應 trigger conditions
const EVENT_TYPE_FILTERS = {
  boot:        { e: 'sys/sys_op' },
  door_open:   { e: 'sys/sys_admin', st: 'OPERATION' },
  door_close:  { e: 'sys/sys_admin', st: 'ADMIN' },
  restock:     { e: { $regex: /^store\// } },
  suspend:     { e: 'sys/sys_suspended' },
  settle:      { e: 'sys/set', 'arg.act': 'settle' },
  config:      { e: 'sys/config_changed' },
};

// All operational event conditions (exclude transaction events)
const ALL_OP_CONDITIONS = Object.values(EVENT_TYPE_FILTERS);

function classifyEvent(trigger) {
  const e = trigger.e;
  const st = trigger.st;
  const arg = trigger.arg || {};

  if (e === 'sys/sys_op') return { type: 'boot', label: '開機' };
  if (e === 'sys/sys_admin' && st === 'OPERATION') return { type: 'door_open', label: '開門' };
  if (e === 'sys/sys_admin' && st === 'ADMIN') return { type: 'door_close', label: '關門' };
  if (e === 'store/start') return { type: 'restock', label: '巡補開始' };
  if (e === 'store/ready') return { type: 'restock', label: '巡補就緒' };
  if (e === 'store/confirmed') return { type: 'restock', label: '巡補確認' };
  if (e === 'store/store_ok') return { type: 'restock', label: '巡補完成' };
  if (e?.startsWith('store/')) return { type: 'restock', label: '巡補' };
  if (e === 'sys/sys_suspended') return { type: 'suspend', label: '停機' };
  if (e === 'sys/set' && arg.act === 'settle') return { type: 'settle', label: '日結' };
  if (e === 'sys/config_changed') return { type: 'config', label: '設定變更' };
  return { type: 'unknown', label: e };
}

export const typeDefs = `#graphql
  type OperationalEvent {
    id: ID!
    deviceId: String!
    vmid: String
    locationName: String
    type: String!
    label: String!
    event: String!
    state: String
    detail: JSON
    timestamp: String!
  }

  enum OpEventType {
    boot
    door_open
    door_close
    restock
    suspend
    settle
    config
  }
`;

export const resolvers = {
  Query: {
    operationalEvents: async (_, { operatorId, deviceId, types, from, to, limit, offset }) => {
      const db = mongoose.connection.db;

      // 1. Get devices for this operator
      const vmsQuery = { operatorId, status: 'active' };
      if (deviceId) vmsQuery.hidCode = deviceId;
      const vms = await db.collection('vms').find(vmsQuery).toArray();
      if (vms.length === 0) return [];

      const deviceIds = vms.map(v => v.hidCode).filter(Boolean);
      const vmMap = new Map();
      for (const v of vms) {
        vmMap.set(v.hidCode, { vmid: v.vmid, locationName: v.locationName });
      }

      // 2. Build trigger query
      const match = { deviceId: { $in: deviceIds } };

      // Event type filter
      if (types && types.length > 0) {
        const conditions = types.map(t => EVENT_TYPE_FILTERS[t]).filter(Boolean);
        if (conditions.length > 0) match.$or = conditions;
        else return [];
      } else {
        match.$or = ALL_OP_CONDITIONS;
      }

      // Time range filter (timestamp is microseconds)
      if (from || to) {
        match.timestamp = {};
        if (from) match.timestamp.$gte = new Date(from).getTime() * 1000;
        if (to) match.timestamp.$lte = new Date(to).getTime() * 1000;
      }

      // 3. Query
      const actualLimit = Math.min(limit || 100, 500);
      const actualOffset = offset || 0;

      const triggers = await db.collection('triggers')
        .find(match)
        .sort({ timestamp: -1 })
        .skip(actualOffset)
        .limit(actualLimit)
        .toArray();

      // 4. Classify and return
      return triggers.map(t => {
        const { type, label } = classifyEvent(t);
        const vm = vmMap.get(t.deviceId) || {};
        return {
          id: t._id.toString(),
          deviceId: t.deviceId,
          vmid: vm.vmid || null,
          locationName: vm.locationName || null,
          type,
          label,
          event: t.e,
          state: t.st || null,
          detail: t.arg || null,
          timestamp: new Date(Math.floor(t.timestamp / 1000)).toISOString(),
        };
      });
    },
  },
};
