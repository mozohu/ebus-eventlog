import mongoose from 'mongoose';

const hidSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  status: { type: String, default: 'active' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'hids' });

hidSchema.pre('save', function () { this.updatedAt = new Date(); });

const Hid = mongoose.model('Hid', hidSchema);

export const typeDefs = `#graphql
  type Hid {
    id: ID!
    code: String!
    status: String!
    notes: String
    createdAt: String
    updatedAt: String
  }

  input CreateHidInput {
    code: String!
    status: String
    notes: String
  }

  input UpdateHidInput {
    status: String
    notes: String
  }
`;

export const resolvers = {
  Hid: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    hids: async (_, { status, limit, offset }) => {
      const query = {};
      if (status) query.status = status;
      return Hid.find(query).sort({ code: 1 }).skip(offset || 0).limit(limit || 100);
    },
    hid: async (_, { id }) => Hid.findById(id),
    hidByCode: async (_, { code }) => Hid.findOne({ code }),
    hidCount: async () => Hid.countDocuments({}),
    availableHids: async (_, { excludeVmId }) => {
      // Get all HID codes currently bound to VMs
      const VmModel = mongoose.model('Vm');
      const boundQuery = { hidCode: { $ne: '' } };
      // If editing an existing VM, exclude its own binding so it shows its current HID
      if (excludeVmId) {
        boundQuery._id = { $ne: new mongoose.Types.ObjectId(excludeVmId) };
      }
      const boundVms = await VmModel.find(boundQuery, { hidCode: 1 });
      const boundCodes = boundVms.map(v => v.hidCode);
      // Return active HIDs not bound to any (other) VM
      return Hid.find({
        status: 'active',
        code: { $nin: boundCodes },
      }).sort({ code: 1 });
    },
  },

  Mutation: {
    createHid: async (_, { input }) => {
      return new Hid({ ...input, createdAt: new Date(), updatedAt: new Date() }).save();
    },
    updateHid: async (_, { id, input }) => {
      return Hid.findByIdAndUpdate(id, { $set: { ...input, updatedAt: new Date() } }, { new: true });
    },
    deleteHid: async (_, { id }) => {
      return (await Hid.findByIdAndDelete(id)) ? true : false;
    },
  },
};
