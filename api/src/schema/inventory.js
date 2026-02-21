import mongoose from 'mongoose';
import { requireAuth } from '../auth.js';

// ============================================================
// Mongoose Schema
// ============================================================

const vmInventorySchema = new mongoose.Schema({
  vmid: { type: String, required: true, index: true },
  operatorId: { type: String, required: true, index: true },
  channelNo: { type: String, required: true },
  productCode: { type: String, required: true },
  maxQty: { type: Number, required: true },
  currentQty: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'vm_inventory' });

vmInventorySchema.index({ vmid: 1, channelNo: 1 }, { unique: true });

const VmInventory = mongoose.model('VmInventory', vmInventorySchema);

// Product model (assumed to exist already)
const Product = mongoose.model('Product');

// ============================================================
// GraphQL TypeDefs
// ============================================================

export const typeDefs = `#graphql
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

  type PicklistChannel {
    channelNo: String!
    currentQty: Int!
    maxQty: Int!
    needed: Int!
  }

  type PicklistItem {
    productCode: String!
    productName: String!
    imageUrl: String
    price: Float
    channels: [PicklistChannel!]!
    totalNeeded: Int!
  }

  input UpdateVmInventoryInput {
    vmid: String!
    channelNo: String!
    currentQty: Int!
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
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  Query: {
    // 取得某台機器所有貨道庫存
    vmInventory: async (_, { vmid }, { user }) => {
      requireAuth(user);
      const inventoryList = await VmInventory.find({ vmid }).sort({ channelNo: 1 });
      
      // 取得所有商品資訊
      const productCodes = [...new Set(inventoryList.map(inv => inv.productCode))];
      const operatorId = inventoryList[0]?.operatorId;
      
      if (!operatorId) return [];
      
      const products = await Product.find({ 
        operatorId, 
        code: { $in: productCodes } 
      });
      
      const productMap = {};
      products.forEach(p => {
        productMap[p.code] = p;
      });
      
      return inventoryList.map(inv => {
        const product = productMap[inv.productCode] || {};
        return {
          vmid: inv.vmid,
          channelNo: inv.channelNo,
          productCode: inv.productCode,
          productName: product.name || '',
          price: product.price || 0,
          maxQty: inv.maxQty,
          currentQty: inv.currentQty,
          imageUrl: product.imageUrl || '',
        };
      });
    },

    // 撿貨彙總（跨機台，按商品 grouping）
    picklistSummary: async (_, { vmids }, { user }) => {
      requireAuth(user);
      const query = {};
      if (vmids && vmids.length > 0) query.vmid = { $in: vmids };
      const all = await VmInventory.find(query).sort({ vmid: 1, channelNo: 1 }).lean();
      if (!all.length) return { vmids: [], rows: [] };

      // Collect unique vmids and operatorIds
      const vmidSet = [...new Set(all.map(i => i.vmid))].sort();
      const opIds = [...new Set(all.map(i => i.operatorId))];

      // Group by productCode, then by vmid (sum channels)
      const grouped = {};
      for (const inv of all) {
        const key = `${inv.operatorId}::${inv.productCode}`;
        if (!grouped[key]) grouped[key] = { productCode: inv.productCode, operatorId: inv.operatorId, vms: {} };
        if (!grouped[key].vms[inv.vmid]) grouped[key].vms[inv.vmid] = { currentQty: 0, maxQty: 0 };
        grouped[key].vms[inv.vmid].currentQty += inv.currentQty;
        grouped[key].vms[inv.vmid].maxQty += inv.maxQty;
      }

      // Get product info
      const prodKeys = Object.values(grouped).map(g => ({ operatorId: g.operatorId, code: g.productCode }));
      const products = await Product.find({ $or: prodKeys.map(k => ({ operatorId: k.operatorId, code: k.code })) }).lean();
      const prodMap = {};
      products.forEach(p => { prodMap[`${p.operatorId}::${p.code}`] = p; });

      const rows = Object.entries(grouped).map(([key, g]) => {
        const prod = prodMap[key] || {};
        const vmArr = vmidSet.map(vmid => {
          const v = g.vms[vmid];
          return { vmid, currentQty: v ? v.currentQty : 0, maxQty: v ? v.maxQty : 0, needed: v ? v.maxQty - v.currentQty : 0 };
        }).filter(v => v.maxQty > 0); // only VMs that have this product
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

    // 撿貨清單（只回傳需要補貨的商品）
    replenishPicklist: async (_, { vmid }, { user }) => {
      requireAuth(user);
      // 找出所有 currentQty < maxQty 的貨道
      const inventoryList = await VmInventory.find({ 
        vmid,
        $expr: { $lt: ['$currentQty', '$maxQty'] }
      }).sort({ channelNo: 1 });
      
      if (inventoryList.length === 0) return [];
      
      const operatorId = inventoryList[0].operatorId;
      
      // 按 productCode 分組
      const groupedByProduct = {};
      inventoryList.forEach(inv => {
        if (!groupedByProduct[inv.productCode]) {
          groupedByProduct[inv.productCode] = {
            productCode: inv.productCode,
            channels: [],
            totalNeeded: 0,
          };
        }
        
        const needed = inv.maxQty - inv.currentQty;
        groupedByProduct[inv.productCode].channels.push({
          channelNo: inv.channelNo,
          currentQty: inv.currentQty,
          maxQty: inv.maxQty,
          needed: needed,
        });
        groupedByProduct[inv.productCode].totalNeeded += needed;
      });
      
      // 取得商品資訊
      const productCodes = Object.keys(groupedByProduct);
      const products = await Product.find({ 
        operatorId, 
        code: { $in: productCodes } 
      });
      
      const productMap = {};
      products.forEach(p => {
        productMap[p.code] = p;
      });
      
      // 組合結果
      const result = productCodes.map(code => {
        const product = productMap[code] || {};
        const group = groupedByProduct[code];
        return {
          productCode: code,
          productName: product.name || '',
          imageUrl: product.imageUrl || '',
          price: product.price || 0,
          channels: group.channels,
          totalNeeded: group.totalNeeded,
        };
      });
      
      // 按 productCode 排序
      result.sort((a, b) => a.productCode.localeCompare(b.productCode));
      
      return result;
    },
  },

  Mutation: {
    // 更新單一貨道庫存
    updateVmInventory: async (_, { input }, { user }) => {
      requireAuth(user);
      const { vmid, channelNo, currentQty } = input;
      
      const updated = await VmInventory.findOneAndUpdate(
        { vmid, channelNo },
        { $set: { currentQty, updatedAt: new Date() } },
        { new: true }
      );
      
      if (!updated) {
        throw new Error(`Inventory not found: ${vmid}/${channelNo}`);
      }
      
      // 回傳完整資訊
      const product = await Product.findOne({ 
        operatorId: updated.operatorId, 
        code: updated.productCode 
      });
      
      return {
        vmid: updated.vmid,
        channelNo: updated.channelNo,
        productCode: updated.productCode,
        productName: product?.name || '',
        price: product?.price || 0,
        maxQty: updated.maxQty,
        currentQty: updated.currentQty,
        imageUrl: product?.imageUrl || '',
      };
    },
  },
};
