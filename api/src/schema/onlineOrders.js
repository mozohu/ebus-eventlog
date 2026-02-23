import mongoose from 'mongoose';
import { requireAuth, requireAdmin, requireOperatorAccess } from '../auth.js';

// ============================================================
// Mongoose Schema
// ============================================================

const onlineOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  lineUserId: { type: String, required: true, index: true },
  displayName: { type: String, default: '' },
  items: [{
    productCode: String,
    operatorId: String,
    productName: String,
    imageUrl: String,
    price: Number,
    qty: Number,
    vmid: String,
    pickedUp: { type: Boolean, default: false },
  }],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'paid', 'ready', 'picked_up', 'cancelled'], default: 'pending' },
  paymentMethod: { type: String, default: 'linepay' },
  pickupCode: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'online_orders' });

const OnlineOrder = mongoose.model('OnlineOrder', onlineOrderSchema);
const VmInventory = mongoose.model('VmInventory');
const Product = mongoose.model('Product');

// ============================================================
// Helpers
// ============================================================

function generateOrderId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `OL-${date}-${rand}`;
}

function generatePickupCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ============================================================
// GraphQL TypeDefs
// ============================================================

export const typeDefs = `#graphql
  type OnlineOrderItem {
    productCode: String!
    operatorId: String!
    productName: String!
    imageUrl: String
    price: Float!
    qty: Int!
    vmid: String
    pickedUp: Boolean
  }

  type OnlineOrder {
    orderId: String!
    lineUserId: String!
    displayName: String
    items: [OnlineOrderItem!]!
    totalAmount: Float!
    status: String!
    paymentMethod: String!
    pickupCode: String
    createdAt: Float
    updatedAt: Float
  }

  type ShopProduct {
    productCode: String!
    operatorId: String!
    productName: String!
    imageUrl: String
    price: Float!
    availableQty: Int!
    locations: [String!]!
  }

  input OrderItemInput {
    productCode: String!
    operatorId: String!
    qty: Int!
  }

  input CreateOnlineOrderInput {
    lineUserId: String!
    displayName: String
    items: [OrderItemInput!]!
    paymentMethod: String!
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  OnlineOrder: {
    displayName: async (order) => {
      if (order.displayName) return order.displayName;
      // Fallback: look up from users collection
      try {
        const User = mongoose.model('User');
        const user = await User.findOne({ lineUserId: order.lineUserId }, { displayName: 1 }).lean();
        return user?.displayName || '';
      } catch { return ''; }
    },
  },
  Query: {
    shopProducts: async () => {
      // Public: browsing shop
      // Aggregate inventory across all VMs, collect vmids for location lookup
      const pipeline = [
        { $match: { currentQty: { $gt: 0 } } },
        { $group: {
          _id: { operatorId: '$operatorId', productCode: '$productCode' },
          availableQty: { $sum: '$currentQty' },
          vmids: { $addToSet: '$vmid' },
        }},
      ];
      const agg = await VmInventory.aggregate(pipeline);
      if (!agg.length) return [];

      // Get product details
      const keys = agg.map(a => ({ operatorId: a._id.operatorId, code: a._id.productCode }));
      const products = await Product.find({ $or: keys }).lean();
      const prodMap = {};
      products.forEach(p => { prodMap[`${p.operatorId}::${p.code}`] = p; });

      // Get VM locations
      const allVmids = [...new Set(agg.flatMap(a => a.vmids))];
      const Vm = mongoose.model('Vm');
      const vms = await Vm.find({ vmid: { $in: allVmids } }, { vmid: 1, locationName: 1 }).lean();
      const vmLocMap = {};
      vms.forEach(v => { if (v.locationName) vmLocMap[v.vmid] = v.locationName; });

      return agg.map(a => {
        const key = `${a._id.operatorId}::${a._id.productCode}`;
        const prod = prodMap[key] || {};
        const locations = [...new Set(a.vmids.map(v => vmLocMap[v]).filter(Boolean))];
        return {
          productCode: a._id.productCode,
          operatorId: a._id.operatorId,
          productName: prod.name || a._id.productCode,
          imageUrl: prod.imageUrl || '',
          price: prod.price || 0,
          availableQty: a.availableQty,
          locations,
        };
      }).filter(p => p.price > 0).sort((a, b) => a.productCode.localeCompare(b.productCode));
    },

    myOrders: async (_, args, { user }) => {
      requireAuth(user);
      // Use user.lineUserId instead of args.lineUserId for security
      return OnlineOrder.find({ lineUserId: user.lineUserId }).sort({ createdAt: -1 }).lean();
    },

    onlineOrder: async (_, { orderId }, { user }) => {
      requireAuth(user);
      const order = await OnlineOrder.findOne({ orderId }).lean();
      if (!order) return null;
      // Allow owner or admin or operator with access
      if (order.lineUserId === user.lineUserId) return order;
      if (user.isAdmin) return order;
      // Check operator access
      const operatorIds = [...new Set(order.items.map(i => i.operatorId))];
      const hasAccess = operatorIds.some(opId => 
        user.operatorRoles.some(r => r.operatorId === opId)
      );
      if (hasAccess) return order;
      throw new Error('無權存取此訂單');
    },

    operatorOnlineOrders: async (_, { operatorId, status, limit }, { user }) => {
      requireOperatorAccess(user, operatorId);
      const query = { 'items.operatorId': operatorId };
      if (status) query.status = status;
      const orders = await OnlineOrder.find(query).sort({ createdAt: -1 }).limit(limit || 100).lean();
      // Filter items to only this operator's
      return orders.map(o => ({
        ...o,
        items: o.items.filter(i => i.operatorId === operatorId),
        totalAmount: o.items.filter(i => i.operatorId === operatorId).reduce((s, i) => s + i.price * i.qty, 0),
      }));
    },

    allOnlineOrders: async (_, { status, limit }, { user }) => {
      requireAdmin(user);
      const query = {};
      if (status) query.status = status;
      return OnlineOrder.find(query).sort({ createdAt: -1 }).limit(limit || 100).lean();
    },
  },

  Mutation: {
    createOnlineOrder: async (_, { input }, { user }) => {
      requireAuth(user);
      const { lineUserId, displayName, items, paymentMethod } = input;
      const orderItems = [];
      let totalAmount = 0;

      for (const item of items) {
        // Look up product
        const product = await Product.findOne({ operatorId: item.operatorId, code: item.productCode }).lean();
        if (!product) throw new Error(`Product not found: ${item.operatorId}/${item.productCode}`);

        // Find VMs with stock and deduct
        let remaining = item.qty;
        const vmsUsed = [];

        const inventoryDocs = await VmInventory.find({
          operatorId: item.operatorId,
          productCode: item.productCode,
          currentQty: { $gt: 0 },
        }).sort({ currentQty: -1 });

        for (const inv of inventoryDocs) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, inv.currentQty);
          await VmInventory.updateOne(
            { _id: inv._id },
            { $inc: { currentQty: -take }, $set: { updatedAt: new Date() } }
          );
          vmsUsed.push({ vmid: inv.vmid, qty: take });
          remaining -= take;
        }

        if (remaining > 0) {
          throw new Error(`Insufficient stock for ${item.productCode}: need ${item.qty}, available ${item.qty - remaining}`);
        }

        // Use the first VM as the primary pickup VM
        const primaryVmid = vmsUsed[0]?.vmid || '';
        const subtotal = product.price * item.qty;
        totalAmount += subtotal;

        orderItems.push({
          productCode: item.productCode,
          operatorId: item.operatorId,
          productName: product.name,
          imageUrl: product.imageUrl || '',
          price: product.price,
          qty: item.qty,
          vmid: primaryVmid,
        });
      }

      const order = await OnlineOrder.create({
        orderId: generateOrderId(),
        lineUserId,
        displayName: displayName || '',
        items: orderItems,
        totalAmount,
        status: 'paid',
        paymentMethod,
        pickupCode: generatePickupCode(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return order.toObject();
    },

    toggleOrderItemPickup: async (_, { orderId, itemIndex, pickedUp }, { user }) => {
      requireAuth(user);
      const order = await OnlineOrder.findOne({ orderId });
      if (!order) throw new Error('Order not found');
      // Check operator access for the item being toggled
      if (itemIndex < 0 || itemIndex >= order.items.length) throw new Error('Invalid item index');
      const item = order.items[itemIndex];
      requireOperatorAccess(user, item.operatorId);
      
      order.items[itemIndex].pickedUp = pickedUp;
      // If all items picked up, auto-update status
      const allPicked = order.items.every(i => i.pickedUp);
      if (allPicked) order.status = 'picked_up';
      else if (order.status === 'picked_up') order.status = 'ready';
      order.updatedAt = new Date();
      await order.save();
      return order.toObject();
    },

    updateOnlineOrderStatus: async (_, { orderId, status }, { user }) => {
      requireAuth(user);
      const order = await OnlineOrder.findOne({ orderId });
      if (!order) throw new Error('Order not found');
      // Check if user has access to at least one operator in the order
      const operatorIds = [...new Set(order.items.map(i => i.operatorId))];
      const hasAccess = user.isAdmin || operatorIds.some(opId => 
        user.operatorRoles.some(r => r.operatorId === opId)
      );
      if (!hasAccess) throw new Error('無權更新此訂單');
      
      const updated = await OnlineOrder.findOneAndUpdate(
        { orderId },
        { $set: { status, updatedAt: new Date() } },
        { new: true }
      );
      return updated?.toObject() || null;
    },
  },
};
