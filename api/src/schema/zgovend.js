import mongoose from 'mongoose';
import { requireAuth } from '../auth.js';

// ============================================================
// Mongoose Models (projection collections from Node-RED)
// ============================================================

const vendSessionSchema = new mongoose.Schema({
  sid: { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, index: true },
  startedAt: Date,
  endedAt: Date,
  status: String,
  createdAt: Date
}, { collection: 'sessions', strict: false });

const vendOrderSchema = new mongoose.Schema({
  oid: { type: String, required: true, unique: true, index: true },
  sid: { type: String, index: true },
  deviceId: { type: String, index: true },
  orderedAt: Date,
  endedAt: Date,
  status: String,
  superseded: Boolean,
  supersededAt: Date,
  arg: { type: mongoose.Schema.Types.Mixed, default: {} },
  hints: { type: mongoose.Schema.Types.Mixed, default: {} },
  paymentHint: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: Date
}, { collection: 'orders', strict: false });

const vendTransactionSchema = new mongoose.Schema({
  txno: { type: String, required: true, unique: true, index: true },
  oid: { type: String, index: true },
  sid: { type: String, index: true },
  deviceId: { type: String, index: true },
  startedAt: Date,
  endedAt: Date,
  status: String,
  arg: { type: mongoose.Schema.Types.Mixed, default: {} },
  payment: { type: mongoose.Schema.Types.Mixed, default: {} },
  dispense: { type: mongoose.Schema.Types.Mixed, default: {} },
  invoice: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: Date
}, { collection: 'transactions', strict: false });

const VendSession = mongoose.model('VendSession', vendSessionSchema);
const VendOrder = mongoose.model('VendOrder', vendOrderSchema);
const VendTransaction = mongoose.model('VendTransaction', vendTransactionSchema);

// ============================================================
// GraphQL typeDefs
// ============================================================

export const typeDefs = `#graphql
  # ==================== 販賣機 (zgovend) ====================

  type VendSession {
    sid: String!
    deviceId: String
    startedAt: String
    endedAt: String
    status: String
    orders: [VendOrder!]
  }

  type VendOrder {
    oid: String!
    sid: String
    deviceId: String
    orderedAt: String
    endedAt: String
    status: String
    superseded: Boolean
    supersededAt: String
    arg: JSON
    hints: JSON
    paymentHint: JSON
    transactions: [VendTransaction!]
  }

  type VendTransaction {
    txno: String!
    oid: String
    sid: String
    deviceId: String
    startedAt: String
    endedAt: String
    status: String
    arg: JSON
    payment: JSON
    dispense: JSON
    invoice: JSON
  }

  type OperatorDailyRevenue {
    operatorId: String!
    revenue: Float!
    txCount: Int!
  }

  type VendTransactionSummary {
    txno: String!
    deviceId: String
    startedAt: String
    endedAt: String
    status: String
    productName: String
    price: Float
    paymentMethod: String
    dispenseSuccess: Boolean
    dispenseChannel: String
    dispenseElapsed: Int
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  VendSession: {
    orders: async (parent) => {
      return VendOrder.find({ sid: parent.sid }).sort({ orderedAt: 1 });
    },
  },

  VendOrder: {
    transactions: async (parent) => {
      return VendTransaction.find({ oid: parent.oid }).sort({ startedAt: 1 });
    },
  },

  Query: {
    vendSessions: async (_, args, { user }) => {
      requireAuth(user);
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.status) query.status = args.status;
      if (args.from || args.to) {
        query.startedAt = {};
        if (args.from) query.startedAt.$gte = new Date(args.from);
        if (args.to) query.startedAt.$lte = new Date(args.to);
      }
      return VendSession.find(query).sort({ startedAt: -1 }).limit(args.limit || 50);
    },

    vendSession: async (_, { sid }, { user }) => {
      requireAuth(user);
      return VendSession.findOne({ sid });
    },

    vendOrders: async (_, args, { user }) => {
      requireAuth(user);
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sid) query.sid = args.sid;
      if (args.superseded !== undefined) query.superseded = args.superseded;
      return VendOrder.find(query).sort({ orderedAt: -1 }).limit(args.limit || 50);
    },

    vendOrder: async (_, { oid }, { user }) => {
      requireAuth(user);
      return VendOrder.findOne({ oid });
    },

    vendTransactions: async (_, args, { user }) => {
      requireAuth(user);
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.sid) query.sid = args.sid;
      if (args.oid) query.oid = args.oid;
      if (args.status) query.status = args.status;
      if (args.from || args.to) {
        query.startedAt = {};
        if (args.from) query.startedAt.$gte = new Date(args.from);
        if (args.to) query.startedAt.$lte = new Date(args.to);
      }
      return VendTransaction.find(query).sort({ startedAt: -1 }).limit(args.limit || 50);
    },

    vendTransaction: async (_, { txno }, { user }) => {
      requireAuth(user);
      return VendTransaction.findOne({ txno });
    },

    dailyRevenueByOperator: async (_, { date }, { user }) => {
      requireAuth(user);
      // date: 'YYYY-MM-DD' (Asia/Taipei), default today
      const d = date ? new Date(date + 'T00:00:00+08:00') : (() => {
        const now = new Date(Date.now() + 8 * 3600000);
        return new Date(now.toISOString().slice(0, 10) + 'T00:00:00+08:00');
      })();
      const nextDay = new Date(d.getTime() + 86400000);

      // Get vm hidCode→operatorId mapping
      const vms = await mongoose.connection.db.collection('vms').find({}, { projection: { hidCode: 1, operatorId: 1 } }).toArray();
      const hidToOp = {};
      for (const vm of vms) if (vm.hidCode) hidToOp[vm.hidCode] = vm.operatorId;

      // Aggregate transactions for the day (all statuses with price)
      const txns = await VendTransaction.find({
        startedAt: { $gte: d, $lt: nextDay },
        'payment.hint.price': { $exists: true, $gt: 0 },
      }, { deviceId: 1, 'payment.hint.price': 1 }).lean();

      const result = {};
      for (const tx of txns) {
        const opId = hidToOp[tx.deviceId];
        if (!opId) continue;
        if (!result[opId]) result[opId] = { operatorId: opId, revenue: 0, txCount: 0 };
        result[opId].revenue += tx.payment?.hint?.price || 0;
        result[opId].txCount += 1;
      }
      return Object.values(result);
    },

    vendTransactionSummaries: async (_, args, { user }) => {
      requireAuth(user);
      const query = {};
      if (args.deviceId) query.deviceId = args.deviceId;
      if (args.status) query.status = args.status;
      if (args.from || args.to) {
        query.startedAt = {};
        if (args.from) query.startedAt.$gte = new Date(args.from);
        if (args.to) query.startedAt.$lte = new Date(args.to);
      }
      const txns = await VendTransaction.find(query).sort({ startedAt: -1 }).limit(args.limit || 50);
      return txns.map(t => ({
        txno: t.txno,
        deviceId: t.deviceId,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        status: t.status,
        productName: t.payment?.hint?.p_name || null,
        price: t.payment?.hint?.price || null,
        paymentMethod: t.arg?.method || null,
        dispenseSuccess: t.dispense?.success || null,
        dispenseChannel: t.dispense?.ready?.chid || null,
        dispenseElapsed: t.dispense?.elapsed || null,
      }));
    },
  },
};
