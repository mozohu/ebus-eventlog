import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import mongoose from 'mongoose';

import * as common from './schema/common.js';
import * as pickup from './schema/pickup.js';
import * as zgovend from './schema/zgovend.js';
import * as users from './schema/users.js';
import * as operators from './schema/operators.js';
import * as hids from './schema/hids.js';
import * as vms from './schema/vms.js';
import * as products from './schema/products.js';
import * as heartbeats from './schema/heartbeats.js';

// ============================================================
// MongoDB connection
// ============================================================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebus';
await mongoose.connect(MONGODB_URI);
console.log('✅ Connected to MongoDB');

// shops/devices collections removed; skip loadStoreDevices

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

    # ==================== Users ====================
    users(limit: Int, offset: Int): [User!]!
    user(lineUserId: String!): User
    userCount: Int!
    usersByOperator(operatorId: String!): [User!]!

    # ==================== Operators ====================
    operators(status: String, limit: Int, offset: Int): [Operator!]!
    operator(id: ID!): Operator
    operatorByCode(code: String!): Operator
    operatorCount: Int!

    # ==================== Hids ====================
    hids(status: String, limit: Int, offset: Int): [Hid!]!
    hid(id: ID!): Hid
    hidByCode(code: String!): Hid
    hidCount: Int!
    availableHids(excludeVmId: ID): [Hid!]!

    # ==================== Vms ====================
    vms(operatorId: String, status: String, limit: Int, offset: Int): [Vm!]!
    vm(id: ID!): Vm
    vmByVmid(vmid: String!): Vm
    vmCount: Int!

    # ==================== Products ====================
    products(operatorId: String, status: String, limit: Int, offset: Int): [Product!]!
    product(id: ID!): Product
    productByCode(operatorId: String!, code: String!): Product
    productCount(operatorId: String): Int!

    # ==================== Heartbeats ====================
    heartbeats(deviceIds: [String!]): [Heartbeat!]!
    heartbeat(deviceId: String!): Heartbeat
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
    # ==================== Users ====================
    upsertUser(input: UpsertUserInput!): User!
    updateUserOperatorRoles(input: UpdateUserOperatorRolesInput!): User

    # ==================== Operators ====================
    createOperator(input: CreateOperatorInput!): Operator!
    updateOperator(id: ID!, input: UpdateOperatorInput!): Operator
    deleteOperator(id: ID!): Boolean!

    # ==================== Hids ====================
    createHid(input: CreateHidInput!): Hid!
    updateHid(id: ID!, input: UpdateHidInput!): Hid
    deleteHid(id: ID!): Boolean!

    # ==================== Vms ====================
    createVm(input: CreateVmInput!): Vm!
    updateVm(id: ID!, input: UpdateVmInput!): Vm
    deleteVm(id: ID!): Boolean!

    # ==================== Products ====================
    createProduct(input: CreateProductInput!): Product!
    updateProduct(id: ID!, input: UpdateProductInput!): Product
    deleteProduct(id: ID!): Boolean!
  }
`;

const typeDefs = [
  common.typeDefs,   // types: Trigger, Transition, inputs, JSON scalar
  pickup.typeDefs,   // types: OrderSummary, StoreInfo, OrderTimeline, OrderEvent, SystemLog
  zgovend.typeDefs,  // types: VendSession, VendOrder, VendTransaction, VendTransactionSummary
  users.typeDefs,    // types: User, OperatorRole, UpsertUserInput, OperatorRoleInput, UpdateUserOperatorRolesInput
  operators.typeDefs, // types: Operator, CreateOperatorInput, UpdateOperatorInput
  hids.typeDefs, // types: Hid, CreateHidInput, UpdateHidInput
  vms.typeDefs, // types: Vm, CreateVmInput, UpdateVmInput
  products.typeDefs, // types: Product, CreateProductInput, UpdateProductInput
  heartbeats.typeDefs, // types: Heartbeat
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
deepMerge(resolvers, users.resolvers);
deepMerge(resolvers, operators.resolvers);
deepMerge(resolvers, hids.resolvers);
deepMerge(resolvers, vms.resolvers);
deepMerge(resolvers, products.resolvers);
deepMerge(resolvers, heartbeats.resolvers);

// ============================================================
// Start server
// ============================================================

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: parseInt(process.env.PORT) || 4000 },
});

console.log(`🚀 GraphQL API ready at ${url}`);
