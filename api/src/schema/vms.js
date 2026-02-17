import mongoose from 'mongoose';

const vmSchema = new mongoose.Schema({
  vmid: { type: String, required: true, unique: true, index: true },
  hidCode: { type: String, index: true, default: '' },
  operatorId: { type: String, index: true, default: '' },
  locationName: { type: String, default: '' },
  locationInfo: { type: String, default: '' },
  status: { type: String, default: 'active' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'vms' });

vmSchema.pre('save', function () { this.updatedAt = new Date(); });

const Vm = mongoose.model('Vm', vmSchema);

export const typeDefs = `#graphql
  type Vm {
    id: ID!
    vmid: String!
    hidCode: String
    operatorId: String
    locationName: String
    locationInfo: String
    status: String!
    notes: String
    createdAt: String
    updatedAt: String
  }

  input CreateVmInput {
    vmid: String!
    hidCode: String
    operatorId: String
    locationName: String
    locationInfo: String
    status: String
    notes: String
  }

  input UpdateVmInput {
    hidCode: String
    operatorId: String
    locationName: String
    locationInfo: String
    status: String
    notes: String
  }
`;

export const resolvers = {
  Vm: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    vms: async (_, { operatorId, status, limit, offset }) => {
      const query = {};
      if (operatorId) query.operatorId = operatorId;
      if (status) query.status = status;
      return Vm.find(query).sort({ vmid: 1 }).skip(offset || 0).limit(limit || 100);
    },
    vm: async (_, { id }) => Vm.findById(id),
    vmByVmid: async (_, { vmid }) => Vm.findOne({ vmid }),
    vmCount: async () => Vm.countDocuments({}),
  },

  Mutation: {
    createVm: async (_, { input }) => {
      return new Vm({ ...input, createdAt: new Date(), updatedAt: new Date() }).save();
    },
    updateVm: async (_, { id, input }) => {
      return Vm.findByIdAndUpdate(id, { $set: { ...input, updatedAt: new Date() } }, { new: true });
    },
    deleteVm: async (_, { id }) => {
      return (await Vm.findByIdAndDelete(id)) ? true : false;
    },
  },
};
