import mongoose from 'mongoose';
import { requireAuth } from '../auth.js';

const stockSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  vmid: { type: String, index: true },
  operatorId: { type: String, index: true },
  channels: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: 'stocks', timestamps: true });

const Stock = mongoose.model('Stock', stockSchema);

export const typeDefs = `#graphql
  type StockChannel {
    chid: String!
    p_id: String
    quantity: Int
    max: Int
  }

  type Stock {
    deviceId: String!
    vmid: String
    operatorId: String
    channels: [StockChannel!]!
    updatedAt: String
  }

  type VmChannel {
    vmid: String!
    channelNo: String!
    productCode: String
    productName: String
    price: Float
    maxQty: Int!
    currentQty: Int!
    imageUrl: String
  }

  type PicklistSummaryVm {
    vmid: String!
    currentQty: Int!
    maxQty: Int!
    needed: Int!
  }

  type PicklistSummaryRow {
    operatorId: String!
    productCode: String!
    productName: String!
    imageUrl: String
    price: Float
    vms: [PicklistSummaryVm!]!
    totalCurrent: Int!
    totalMax: Int!
    totalNeeded: Int!
  }

  type PicklistSummary {
    vmids: [String!]!
    rows: [PicklistSummaryRow!]!
  }

  input UpdateVmInventoryInput {
    vmid: String!
    channelNo: String!
    currentQty: Int!
  }
`;

export const resolvers = {
  Stock: {
    channels: (parent) => {
      if (!parent.channels) return [];
      return Object.entries(parent.channels).map(([chid, ch]) => ({
        chid,
        p_id: ch.p_id || '',
        quantity: ch.quantity ?? 0,
        max: ch.max ?? 0,
      }));
    },
  },

  Query: {
    stock: async (_, { deviceId }) => {
      return Stock.findOne({ deviceId });
    },
    stocks: async (_, { deviceIds }) => {
      const match = {};
      if (deviceIds && deviceIds.length > 0) match.deviceId = { $in: deviceIds };
      return Stock.find(match).lean();
    },

    // 取得某台機器所有貨道庫存（enriched with product info）
    vmInventory: async (_, { vmid }, { user }) => {
      requireAuth(user);
      const stock = await Stock.findOne({ vmid }).lean();
      if (!stock || !stock.channels) return [];
      const operatorId = stock.operatorId;
      if (!operatorId) return [];

      const Product = mongoose.model('Product');
      const pIds = [...new Set(Object.values(stock.channels).map(ch => ch.p_id).filter(Boolean))];
      const products = await Product.find({ operatorId, code: { $in: pIds } }).lean();
      const prodMap = {};
      products.forEach(p => { prodMap[p.code] = p; });

      return Object.entries(stock.channels).map(([chid, ch]) => {
        const prod = prodMap[ch.p_id] || {};
        return {
          vmid,
          channelNo: chid,
          productCode: ch.p_id || '',
          productName: prod.name || '',
          price: prod.price || 0,
          maxQty: ch.max || 0,
          currentQty: ch.quantity || 0,
          imageUrl: prod.imageUrl || '',
        };
      }).sort((a, b) => a.channelNo.localeCompare(b.channelNo));
    },

    // 撿貨彙總（跨機台，按商品 grouping）
    picklistSummary: async (_, { vmids }, { user }) => {
      requireAuth(user);
      const query = {};
      if (vmids && vmids.length > 0) query.vmid = { $in: vmids };
      const allStocks = await Stock.find(query).lean();
      if (!allStocks.length) return { vmids: [], rows: [] };

      const vmidSet = [...new Set(allStocks.map(s => s.vmid).filter(Boolean))].sort();
      const Product = mongoose.model('Product');

      // Flatten channels into per-product per-vm records
      const grouped = {};
      for (const s of allStocks) {
        if (!s.vmid || !s.operatorId || !s.channels) continue;
        for (const [chid, ch] of Object.entries(s.channels)) {
          const pCode = ch.p_id;
          if (!pCode) continue;
          const key = `${s.operatorId}::${pCode}`;
          if (!grouped[key]) grouped[key] = { productCode: pCode, operatorId: s.operatorId, vms: {} };
          if (!grouped[key].vms[s.vmid]) grouped[key].vms[s.vmid] = { currentQty: 0, maxQty: 0 };
          grouped[key].vms[s.vmid].currentQty += (ch.quantity || 0);
          grouped[key].vms[s.vmid].maxQty += (ch.max || 0);
        }
      }

      // Get product info
      const prodKeys = Object.values(grouped).map(g => ({ operatorId: g.operatorId, code: g.productCode }));
      const products = prodKeys.length > 0 ? await Product.find({ $or: prodKeys }).lean() : [];
      const prodMap = {};
      products.forEach(p => { prodMap[`${p.operatorId}::${p.code}`] = p; });

      const rows = Object.entries(grouped).map(([key, g]) => {
        const prod = prodMap[key] || {};
        const vmArr = vmidSet.map(vmid => {
          const v = g.vms[vmid];
          return { vmid, currentQty: v ? v.currentQty : 0, maxQty: v ? v.maxQty : 0, needed: v ? Math.max(0, v.maxQty - v.currentQty) : 0 };
        }).filter(v => v.maxQty > 0);
        return {
          operatorId: g.operatorId,
          productCode: g.productCode,
          productName: prod.name || g.productCode,
          imageUrl: prod.imageUrl || '',
          price: prod.price || 0,
          vms: vmArr,
          totalCurrent: vmArr.reduce((s, v) => s + v.currentQty, 0),
          totalMax: vmArr.reduce((s, v) => s + v.maxQty, 0),
          totalNeeded: vmArr.reduce((s, v) => s + v.needed, 0),
        };
      }).filter(r => r.totalNeeded > 0).sort((a, b) => a.productCode.localeCompare(b.productCode));

      return { vmids: vmidSet, rows };
    },
  },

  Mutation: {
    // 更新單一貨道庫存
    updateVmInventory: async (_, { input }, { user }) => {
      requireAuth(user);
      const { vmid, channelNo, currentQty } = input;
      const stock = await Stock.findOne({ vmid });
      if (!stock) throw new Error(`Stock not found for VM: ${vmid}`);
      if (!stock.channels?.[channelNo]) throw new Error(`Channel not found: ${vmid}/${channelNo}`);

      stock.channels[channelNo].quantity = currentQty;
      stock.markModified('channels');
      await stock.save();

      const Product = mongoose.model('Product');
      const pId = stock.channels[channelNo].p_id;
      const product = pId ? await Product.findOne({ operatorId: stock.operatorId, code: pId }) : null;

      return {
        vmid,
        channelNo,
        productCode: pId || '',
        productName: product?.name || '',
        price: product?.price || 0,
        maxQty: stock.channels[channelNo].max || 0,
        currentQty,
        imageUrl: product?.imageUrl || '',
      };
    },
  },
};
