import mongoose from 'mongoose';

// ============================================================
// Mongoose Models
// ============================================================

const templateSchema = new mongoose.Schema({
  operatorId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  sourceType: { type: String, default: 'blank' }, // blank | machine | template
  sourceId: { type: String, default: '' },
  status: { type: String, default: 'active' },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'preset_stock_templates' });

templateSchema.pre('save', function () { this.updatedAt = new Date(); });

const channelSchema = new mongoose.Schema({
  templateId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  operatorId: { type: String, required: true, index: true },
  channelNo: { type: String, required: true },
  productId: { type: String, default: '' },
  parLevel: { type: Number, default: 0 },
  stockLevel: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'preset_stock_channels' });

channelSchema.index({ templateId: 1, channelNo: 1 }, { unique: true });
channelSchema.pre('save', function () { this.updatedAt = new Date(); });

const PresetStockTemplate = mongoose.model('PresetStockTemplate', templateSchema);
const PresetStockChannel = mongoose.model('PresetStockChannel', channelSchema);

// ============================================================
// GraphQL typeDefs
// ============================================================

export const typeDefs = `#graphql
  type PresetStockTemplate {
    id: ID!
    operatorId: String!
    name: String!
    sourceType: String!
    sourceId: String
    status: String
    createdBy: String
    createdAt: String
    updatedAt: String
    channels: [PresetStockChannel!]!
  }

  type PresetStockChannel {
    id: ID!
    templateId: ID!
    channelNo: String!
    productId: String
    productCode: String
    productName: String
    parLevel: Int!
    stockLevel: Int!
  }

  input PresetStockChannelInput {
    channelNo: String!
    productId: String
    parLevel: Int!
    stockLevel: Int!
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  PresetStockTemplate: {
    channels: async (parent) => {
      const channels = await PresetStockChannel.find({ templateId: parent._id || parent.id }).sort({ channelNo: 1 }).lean();
      // Resolve product names
      const productIds = [...new Set(channels.filter(c => c.productId && c.productId !== '__UNCHANGED__').map(c => c.productId))];
      let productMap = {};
      if (productIds.length > 0) {
        const Product = mongoose.model('Product');
        const products = await Product.find({ _id: { $in: productIds } }, { name: 1, code: 1 }).lean();
        for (const p of products) {
          productMap[p._id.toString()] = p.name;
        }
        // Build code map: MongoDB _id → product code
        var productCodeMap = {};
        for (const p of products) productCodeMap[p._id.toString()] = p.code;
      }
      return channels.map(c => ({
        id: c._id.toString(),
        templateId: c.templateId.toString(),
        channelNo: c.channelNo,
        productId: c.productId || null,
        productCode: c.productId ? (productCodeMap?.[c.productId] || null) : null,
        productName: c.productId ? (productMap[c.productId] || null) : null,
        parLevel: c.parLevel,
        stockLevel: c.stockLevel,
      }));
    },
  },

  Query: {
    presetStockTemplates: async (_, { operatorId, status }) => {
      const query = {};
      if (operatorId) query.operatorId = operatorId;
      if (status) query.status = status;
      return PresetStockTemplate.find(query).sort({ updatedAt: -1 });
    },

    presetStockTemplate: async (_, { id }) => {
      return PresetStockTemplate.findById(id);
    },
  },

  Mutation: {
    createPresetStockTemplate: async (_, { input }) => {
      return new PresetStockTemplate(input).save();
    },

    copyPresetStockFromMachine: async (_, { operatorId, name, machineId }) => {
      // Create template, then copy machine's current channel layout
      const template = await new PresetStockTemplate({
        operatorId,
        name,
        sourceType: 'machine',
        sourceId: machineId,
      }).save();

      // Try to get machine channels from vms collection
      const Vm = mongoose.model('Vm');
      const vm = await Vm.findById(machineId).lean();
      if (vm && vm.channels && Array.isArray(vm.channels)) {
        const channelDocs = vm.channels.map(ch => ({
          templateId: template._id,
          operatorId,
          channelNo: ch.channelNo || ch.chid || '',
          productId: ch.productId || '',
          parLevel: ch.parLevel || ch.capacity || 0,
          stockLevel: ch.stockLevel || ch.qty || 0,
        }));
        if (channelDocs.length > 0) {
          await PresetStockChannel.insertMany(channelDocs);
        }
      }
      return template;
    },

    copyPresetStockFromTemplate: async (_, { operatorId, name, sourceTemplateId }) => {
      const source = await PresetStockTemplate.findById(sourceTemplateId);
      if (!source) throw new Error('來源設定檔不存在');

      const template = await new PresetStockTemplate({
        operatorId,
        name,
        sourceType: 'template',
        sourceId: sourceTemplateId,
      }).save();

      // Copy channels
      const sourceChannels = await PresetStockChannel.find({ templateId: source._id }).lean();
      if (sourceChannels.length > 0) {
        const channelDocs = sourceChannels.map(ch => ({
          templateId: template._id,
          operatorId,
          channelNo: ch.channelNo,
          productId: ch.productId,
          parLevel: ch.parLevel,
          stockLevel: ch.stockLevel,
        }));
        await PresetStockChannel.insertMany(channelDocs);
      }
      return template;
    },

    renamePresetStockTemplate: async (_, { id, name }) => {
      return PresetStockTemplate.findByIdAndUpdate(id, { name, updatedAt: new Date() }, { new: true });
    },

    deletePresetStockTemplate: async (_, { id }) => {
      await PresetStockChannel.deleteMany({ templateId: id });
      const result = await PresetStockTemplate.findByIdAndDelete(id);
      return !!result;
    },

    updatePresetStockChannels: async (_, { templateId, channels }) => {
      const template = await PresetStockTemplate.findById(templateId);
      if (!template) throw new Error('設定檔不存在');

      // Replace all channels
      await PresetStockChannel.deleteMany({ templateId });
      if (channels.length > 0) {
        const docs = channels.map(ch => ({
          templateId,
          operatorId: template.operatorId,
          channelNo: ch.channelNo,
          productId: ch.productId || '',
          parLevel: ch.parLevel,
          stockLevel: ch.stockLevel,
        }));
        await PresetStockChannel.insertMany(docs);
      }

      template.updatedAt = new Date();
      await template.save();
      return template;
    },
  },
};
