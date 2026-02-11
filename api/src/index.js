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

const Trigger = mongoose.model('Trigger', triggerSchema);
const Transition = mongoose.model('Transition', transitionSchema);

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

// 店號對應設備 ID 映射
const STORE_DEVICES = {
  'vm01': {
    storer: '0242ac1c0002',
    retriever: '0242ac1e0008'
  },
  'vm02': {
    storer: '0242ac220002',
    retriever: '0242ac230008'
  }
};

// 根據 deviceId 反查店號
function getStoreId(deviceId) {
  for (const [storeId, devices] of Object.entries(STORE_DEVICES)) {
    if (devices.storer === deviceId || devices.retriever === deviceId) {
      return storeId;
    }
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

    // 店號清單
    stores: () => {
      return Object.entries(STORE_DEVICES).map(([storeId, devices]) => ({
        storeId,
        name: `${storeId}店`,
        storerDeviceId: devices.storer,
        retrieverDeviceId: devices.retriever
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
      
      // 指定 orderId
      if (args.orderId) {
        query['arg.oid'] = args.orderId;
      }
      
      // 指定 token
      if (args.token) {
        query['arg.token'] = args.token;
      }
      
      // 指定格口
      if (args.chid) {
        query['arg.chid'] = args.chid;
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
      const token = storeEvent?.arg?.token;
      const chid = storeEvent?.arg?.chid?.[0];

      return [{
        orderId: args.orderId,
        token,
        chid,
        events: events.map(e => ({
          timestamp: e.timestamp,
          e: e.e,
          arg: e.arg,
          sm: e.sm,
          trigger: e.trigger,
          st: e.st,
          deviceId: e.deviceId
        }))
      }];
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
  },
};

// Start server
const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: parseInt(process.env.PORT) || 4000 },
});

console.log(`🚀 GraphQL API ready at ${url}`);
