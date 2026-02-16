import mongoose from 'mongoose';
import { GraphQLScalarType, Kind } from 'graphql';

// ============================================================
// Mongoose Models
// ============================================================

const triggerSchema = new mongoose.Schema({
  timestamp: { type: Number, required: true, index: true },
  e: { type: String, required: true },
  arg: { type: mongoose.Schema.Types.Mixed, default: {} },
  s: String,
  can: Number,
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

const shopSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  storerDeviceId: { type: String, default: '' },
  retrieverDeviceId: { type: String, default: '' }
}, { collection: 'shops' });

const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }
}, { collection: 'devices' });

export const Trigger = mongoose.model('Trigger', triggerSchema);
export const Transition = mongoose.model('Transition', transitionSchema);
export const Shop = mongoose.model('Shop', shopSchema);
export const Device = mongoose.model('Device', deviceSchema);

// ============================================================
// Store-Device mapping cache
// ============================================================

export let STORE_DEVICES = {};

export async function loadStoreDevices() {
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

export function getStoreId(deviceId) {
  for (const [storeId, devices] of Object.entries(STORE_DEVICES)) {
    if (devices.storer === deviceId || devices.retriever === deviceId) return storeId;
  }
  return null;
}

export function getDeviceType(deviceId) {
  for (const [storeId, devices] of Object.entries(STORE_DEVICES)) {
    if (devices.storer === deviceId) return '存餐機';
    if (devices.retriever === deviceId) return '取餐機';
  }
  return null;
}

// ============================================================
// Cabin Status helpers
// ============================================================

export const CABIN_FLAGS = {
  FRONT_DOOR_OPEN: { bit: 0, value: 1, name: '前門開啟' },
  BACK_DOOR_OPEN:  { bit: 1, value: 2, name: '後門開啟' },
  TOF_EMPTY:       { bit: 2, value: 4, name: 'ToF無物品' },
  UV_LIGHT_ON:     { bit: 3, value: 8, name: '殺菌燈亮' },
  FAULT:           { bit: 7, value: 128, name: '故障' }
};

const HIDDEN_FLAGS = ['後門開啟', '故障'];

export function parseCabinStatusChange(oldStatus, newStatus) {
  const changes = [];
  for (const [key, flag] of Object.entries(CABIN_FLAGS)) {
    if (HIDDEN_FLAGS.includes(flag.name)) continue;
    const wasSet = (oldStatus & flag.value) !== 0;
    const isSet = (newStatus & flag.value) !== 0;
    if (wasSet !== isSet) {
      let desc;
      if (flag.name === 'ToF無物品') desc = isSet ? '感測無物' : '感測有物';
      else if (flag.name === '前門開啟') desc = isSet ? '前門開啟' : '前門關閉';
      else if (flag.name === '殺菌燈亮') desc = isSet ? '殺菌燈亮' : '殺菌燈滅';
      else desc = isSet ? flag.name : `非${flag.name}`;
      changes.push({ flag: flag.name, from: wasSet, to: isSet, desc });
    }
  }
  return changes;
}

export function cabinStatusSummary(oldStatus, newStatus) {
  const changes = parseCabinStatusChange(oldStatus, newStatus);
  if (changes.length === 0) return '無變化';
  return changes.map(c => c.desc).join(', ');
}

// ============================================================
// JSON Scalar
// ============================================================

function parseObject(ast) {
  const obj = {};
  ast.fields.forEach(field => {
    obj[field.name.value] = JSONScalar.parseLiteral(field.value);
  });
  return obj;
}

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON scalar type',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING: return JSON.parse(ast.value);
      case Kind.OBJECT: return parseObject(ast);
      case Kind.LIST: return ast.values.map(v => JSONScalar.parseLiteral(v));
      case Kind.INT: return parseInt(ast.value, 10);
      case Kind.FLOAT: return parseFloat(ast.value);
      case Kind.BOOLEAN: return ast.value;
      case Kind.NULL: return null;
      default: return null;
    }
  },
});

// ============================================================
// Common typeDefs (triggers, transitions, devices, shops, admin)
// ============================================================

export const typeDefs = `#graphql
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

  type Shop {
    id: String!
    name: String!
    storerDeviceId: String
    retrieverDeviceId: String
  }

  type Device {
    id: String!
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
`;

// ============================================================
// Common resolvers
// ============================================================

export const resolvers = {
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
      return Trigger.find(query).sort({ timestamp: -1 }).skip(args.offset || 0).limit(args.limit || 100);
    },
    trigger: async (_, { id }) => Trigger.findById(id),
    triggerCount: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      return Trigger.countDocuments(query);
    },
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
      return Transition.find(query).sort({ timestamp: -1 }).skip(args.offset || 0).limit(args.limit || 100);
    },
    transition: async (_, { id }) => Transition.findById(id),
    transitionCount: async (_, args) => {
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sm) query.sm = args.sm;
      return Transition.countDocuments(query);
    },
    stateMachines: async (_, args) => {
      const match = args.deviceId ? { deviceId: args.deviceId } : {};
      return Trigger.distinct('sm', match);
    },
    devices: async () => {
      const triggers = await Trigger.distinct('deviceId');
      const transitions = await Transition.distinct('deviceId');
      return [...new Set([...triggers, ...transitions])].filter(Boolean);
    },
    allShops: async () => Shop.find({}).sort({ id: 1 }),
    shop: async (_, { id }) => Shop.findOne({ id }),
    allDevices: async () => Device.find({}).sort({ id: 1 }),
    device: async (_, { id }) => Device.findOne({ id }),
  },

  Mutation: {
    createTrigger: async (_, { input }) => new Trigger(input).save(),
    createTriggers: async (_, { inputs }) => Trigger.insertMany(inputs),
    deleteTrigger: async (_, { id }) => !!(await Trigger.findByIdAndDelete(id)),
    deleteTriggersByDevice: async (_, { deviceId }) => (await Trigger.deleteMany({ deviceId })).deletedCount,
    createTransition: async (_, { input }) => new Transition(input).save(),
    createTransitions: async (_, { inputs }) => Transition.insertMany(inputs),
    deleteTransition: async (_, { id }) => !!(await Transition.findByIdAndDelete(id)),
    deleteTransitionsByDevice: async (_, { deviceId }) => (await Transition.deleteMany({ deviceId })).deletedCount,

    createShop: async (_, { input }) => {
      input.storerDeviceId = input.storerDeviceId || '';
      input.retrieverDeviceId = input.retrieverDeviceId || '';
      if (input.storerDeviceId && input.retrieverDeviceId && input.storerDeviceId === input.retrieverDeviceId)
        throw new Error('存餐機和取餐機不能使用同一個設備');
      if (input.storerDeviceId) {
        if (await Shop.findOne({ storerDeviceId: input.storerDeviceId }))
          throw new Error(`存餐機 ${input.storerDeviceId} 已被使用`);
        if (await Shop.findOne({ retrieverDeviceId: input.storerDeviceId }))
          throw new Error(`設備 ${input.storerDeviceId} 已被作為取餐機使用`);
      }
      if (input.retrieverDeviceId) {
        if (await Shop.findOne({ retrieverDeviceId: input.retrieverDeviceId }))
          throw new Error(`取餐機 ${input.retrieverDeviceId} 已被使用`);
        if (await Shop.findOne({ storerDeviceId: input.retrieverDeviceId }))
          throw new Error(`設備 ${input.retrieverDeviceId} 已被作為存餐機使用`);
      }
      const shop = new Shop(input);
      await shop.save();
      await loadStoreDevices();
      return shop;
    },
    updateShop: async (_, { id, input }) => {
      input.storerDeviceId = input.storerDeviceId || '';
      input.retrieverDeviceId = input.retrieverDeviceId || '';
      if (input.storerDeviceId && input.retrieverDeviceId && input.storerDeviceId === input.retrieverDeviceId)
        throw new Error('存餐機和取餐機不能使用同一個設備');
      if (input.storerDeviceId) {
        if (await Shop.findOne({ storerDeviceId: input.storerDeviceId, id: { $ne: id } }))
          throw new Error(`存餐機 ${input.storerDeviceId} 已被其他店鋪使用`);
        if (await Shop.findOne({ retrieverDeviceId: input.storerDeviceId, id: { $ne: id } }))
          throw new Error(`設備 ${input.storerDeviceId} 已被其他店鋪作為取餐機使用`);
      }
      if (input.retrieverDeviceId) {
        if (await Shop.findOne({ retrieverDeviceId: input.retrieverDeviceId, id: { $ne: id } }))
          throw new Error(`取餐機 ${input.retrieverDeviceId} 已被其他店鋪使用`);
        if (await Shop.findOne({ storerDeviceId: input.retrieverDeviceId, id: { $ne: id } }))
          throw new Error(`設備 ${input.retrieverDeviceId} 已被其他店鋪作為存餐機使用`);
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
    createDevice: async (_, { input }) => new Device(input).save(),
    deleteDevice: async (_, { id }) => {
      if (await Shop.findOne({ storerDeviceId: id })) throw new Error(`設備 ${id} 作為存餐機使用中`);
      if (await Shop.findOne({ retrieverDeviceId: id })) throw new Error(`設備 ${id} 作為取餐機使用中`);
      return (await Device.deleteOne({ id })).deletedCount > 0;
    },
    reloadShops: async () => { await loadStoreDevices(); return true; },
  },
};
