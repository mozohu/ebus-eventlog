import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import mongoose from 'mongoose';

import * as common from './schema/common.js';
import * as pickup from './schema/pickup.js';
import * as zgovend from './schema/zgovend.js';

// ============================================================
// MongoDB connection
// ============================================================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebus';
await mongoose.connect(MONGODB_URI);
console.log('✅ Connected to MongoDB');

// Load store-device mapping cache
await common.loadStoreDevices();

// ============================================================
// Merge typeDefs
// ============================================================

// Build combined Query and Mutation type from all modules
const rootTypeDefs = `#graphql
  type Query {
    # ==================== Common ====================
    triggers(deviceId: String, sm: String, trigger: String, fromTimestamp: Float, toTimestamp: Float, limit: Int, offset: Int): [Trigger!]!
    trigger(id: ID!): Trigger
    triggerCount(deviceId: String, sm: String): Int!
    transitions(deviceId: String, sm: String, transition: String, fst: String, tst: String, fromTimestamp: Float, toTimestamp: Float, limit: Int, offset: Int): [Transition!]!
    transition(id: ID!): Transition
    transitionCount(deviceId: String, sm: String): Int!
    stateMachines(deviceId: String): [String!]!
    devices: [String!]!
    allShops: [Shop!]!
    shop(id: String!): Shop
    allDevices: [Device!]!
    device(id: String!): Device

    # ==================== Pickup (取餐櫃) ====================
    orderList(storeId: String, orderId: String, token: String, chid: String, fromTimestamp: Float, toTimestamp: Float, limit: Int): [OrderSummary!]!
    stores: [StoreInfo!]!
    orderTimeline(orderId: String!): [OrderTimeline!]!
    systemLogs(storeId: String, chid: String, fromTimestamp: Float, toTimestamp: Float, limit: Int): [SystemLog!]!

    # ==================== Vend (販賣機) ====================
    vendSessions(deviceId: String, status: String, from: Float, to: Float, limit: Int): [VendSession!]!
    vendSession(sid: String!): VendSession
    vendOrders(deviceId: String, sid: String, superseded: Boolean, limit: Int): [VendOrder!]!
    vendOrder(oid: String!): VendOrder
    vendTransactions(deviceId: String, sid: String, oid: String, status: String, from: Float, to: Float, limit: Int): [VendTransaction!]!
    vendTransaction(txno: String!): VendTransaction
    vendTransactionSummaries(deviceId: String, status: String, from: Float, to: Float, limit: Int): [VendTransactionSummary!]!
  }

  type Mutation {
    # ==================== Common ====================
    createTrigger(input: TriggerInput!): Trigger!
    createTriggers(inputs: [TriggerInput!]!): [Trigger!]!
    deleteTrigger(id: ID!): Boolean!
    deleteTriggersByDevice(deviceId: String!): Int!
    createTransition(input: TransitionInput!): Transition!
    createTransitions(inputs: [TransitionInput!]!): [Transition!]!
    deleteTransition(id: ID!): Boolean!
    deleteTransitionsByDevice(deviceId: String!): Int!
    createShop(input: ShopInput!): Shop!
    updateShop(id: String!, input: ShopInput!): Shop
    deleteShop(id: String!): Boolean!
    createDevice(input: DeviceInput!): Device!
    deleteDevice(id: String!): Boolean!
    reloadShops: Boolean!
  }
`;

const typeDefs = [
  common.typeDefs,   // types: Trigger, Transition, Shop, Device, inputs, JSON scalar
  pickup.typeDefs,   // types: OrderSummary, StoreInfo, OrderTimeline, OrderEvent, SystemLog
  zgovend.typeDefs,  // types: VendSession, VendOrder, VendTransaction, VendTransactionSummary
  rootTypeDefs,      // root Query + Mutation
];

// ============================================================
// Merge resolvers
// ============================================================

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const resolvers = {};
deepMerge(resolvers, common.resolvers);
deepMerge(resolvers, pickup.resolvers);
deepMerge(resolvers, zgovend.resolvers);

// ============================================================
// Start server
// ============================================================

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: parseInt(process.env.PORT) || 4000 },
});

console.log(`🚀 GraphQL API ready at ${url}`);
