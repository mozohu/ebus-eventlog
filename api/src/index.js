import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import { authenticateRequest } from './auth.js';

import * as common from './schema/common.js';
import * as pickup from './schema/pickup.js';
import * as zgovend from './schema/zgovend.js';
import * as users from './schema/users.js';
import * as operators from './schema/operators.js';
import * as hids from './schema/hids.js';
import * as vms from './schema/vms.js';
import * as products from './schema/products.js';
import * as heartbeats from './schema/heartbeats.js';
import * as presetStock from './schema/presetStock.js';
// inventory.js merged into stocks.js
import * as stocks from './schema/stocks.js';
import * as onlineOrders from './schema/onlineOrders.js';
import * as tickets from './schema/tickets.js';
import * as dailyStats from './schema/dailyStats.js';
import * as sessionTimeline from './schema/sessionTimeline.js';
import * as paymentMethods from './schema/paymentMethods.js';

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
    dailyRevenueByOperator(date: String): [OperatorDailyRevenue!]!

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

    # ==================== Stocks ====================
    stock(deviceId: String!): Stock
    stocks(deviceIds: [String!]): [Stock!]!
    # ==================== Heartbeats ====================
    heartbeats(deviceIds: [String!]): [Heartbeat!]!
    heartbeat(deviceId: String!): Heartbeat
    tempHistory(deviceId: String!, limit: Int): [TemperatureRecord!]!

    # ==================== Preset Stock ====================
    presetStockTemplates(operatorId: String, status: String): [PresetStockTemplate!]!
    presetStockTemplate(id: ID!): PresetStockTemplate

    # ==================== Inventory ====================
    vmInventory(vmid: String!): [VmChannel!]!
    picklistSummary(vmids: [String!]): PicklistSummary!

    # ==================== Online Orders ====================
    shopProducts: [ShopProduct!]!
    myOrders(lineUserId: String!): [OnlineOrder!]!
    onlineOrder(orderId: String!): OnlineOrder
    operatorOnlineOrders(operatorId: String!, status: String, limit: Int): [OnlineOrder!]!
    allOnlineOrders(status: String, limit: Int): [OnlineOrder!]!

    # ==================== Tickets ====================
    myTickets(lineUserId: String!): [Ticket!]!
    ticket(ticketId: String!): Ticket
    operatorTickets(operatorId: String!, status: String): [Ticket!]!
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

    # ==================== Preset Stock ====================
    createPresetStockTemplate(input: CreatePresetStockTemplateInput!): PresetStockTemplate!
    copyPresetStockFromMachine(operatorId: String!, name: String!, machineId: ID!): PresetStockTemplate!
    copyPresetStockFromTemplate(operatorId: String!, name: String!, sourceTemplateId: ID!): PresetStockTemplate!
    renamePresetStockTemplate(id: ID!, name: String!): PresetStockTemplate
    deletePresetStockTemplate(id: ID!): Boolean!
    updatePresetStockChannels(templateId: ID!, channels: [PresetStockChannelInput!]!): PresetStockTemplate!

    # ==================== Inventory ====================
    updateVmInventory(input: UpdateVmInventoryInput!): VmChannel!

    # ==================== Online Orders ====================
    createOnlineOrder(input: CreateOnlineOrderInput!): OnlineOrder!
    updateOnlineOrderStatus(orderId: String!, status: String!): OnlineOrder
    toggleOrderItemPickup(orderId: String!, itemIndex: Int!, pickedUp: Boolean!): OnlineOrder

    # ==================== Heartbeats ====================
    createHeartbeat(input: CreateHeartbeatInput!): Heartbeat!
    # ==================== Tickets ====================
    createTicket(input: CreateTicketInput!): Ticket!
    replyTicket(ticketId: String!, from: String!, displayName: String!, text: String!): Ticket!
    updateTicketStatus(ticketId: String!, status: String!): Ticket!
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
  presetStock.typeDefs, // types: PresetStockTemplate, PresetStockChannel
  // inventory types moved to stocks.typeDefs
  onlineOrders.typeDefs, // types: OnlineOrder, ShopProduct
  tickets.typeDefs, // types: Ticket, TicketMessage, CreateTicketInput
  dailyStats.typeDefs, // types: DailyStatPoint, DailyStatDetail
  stocks.typeDefs,
  sessionTimeline.typeDefs, // types: SessionTimeline, TimelineEvent, SessionInfo, TransactionInfo
  paymentMethods.typeDefs, // types: PaymentMethodEntry
  `#graphql
    input CreatePresetStockTemplateInput {
      operatorId: String!
      name: String!
    }
  `,
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
deepMerge(resolvers, presetStock.resolvers);
// inventory resolvers moved to stocks.resolvers
deepMerge(resolvers, onlineOrders.resolvers);
deepMerge(resolvers, tickets.resolvers);
deepMerge(resolvers, dailyStats.resolvers);
deepMerge(resolvers, stocks.resolvers);
deepMerge(resolvers, sessionTimeline.resolvers);
deepMerge(resolvers, paymentMethods.resolvers);

// ============================================================
// Start server
// ============================================================

import { handleUpload } from './upload.js';

const apolloServer = new ApolloServer({ typeDefs, resolvers });
await apolloServer.start();

const app = express();

// Upload endpoint (before body parsers — needs raw body for multipart)
app.post('/upload/product-image', (req, res) => handleUpload(req, res));
app.options('/upload/product-image', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.writeHead(204);
  res.end();
});

// GraphQL
app.use('/graphql', express.json(), expressMiddleware(apolloServer, {
  context: async ({ req }) => {
    const user = await authenticateRequest(req);
    return { user };
  },
}));

// Also mount at root for backward compat (startStandaloneServer served at /)
app.use('/', express.json(), expressMiddleware(apolloServer, {
  context: async ({ req }) => {
    const user = await authenticateRequest(req);
    return { user };
  },
}));

const PORT = parseInt(process.env.PORT) || 4000;
const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`🚀 GraphQL API ready at http://localhost:${PORT}/`);
  console.log(`📤 Upload endpoint at http://localhost:${PORT}/upload/product-image`);
});
