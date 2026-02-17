import mongoose from 'mongoose';

const operatorSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  status: { type: String, default: 'active' },
  contactName: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  contactPhone: { type: String, default: '' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'operators' });

operatorSchema.pre('save', function () { this.updatedAt = new Date(); });

const Operator = mongoose.model('Operator', operatorSchema);

export const typeDefs = `#graphql
  type Operator {
    id: ID!
    code: String!
    name: String!
    status: String!
    contactName: String
    contactEmail: String
    contactPhone: String
    notes: String
    createdAt: String
    updatedAt: String
  }

  input CreateOperatorInput {
    code: String!
    name: String!
    status: String
    contactName: String
    contactEmail: String
    contactPhone: String
    notes: String
  }

  input UpdateOperatorInput {
    name: String
    status: String
    contactName: String
    contactEmail: String
    contactPhone: String
    notes: String
  }
`;

export const resolvers = {
  Operator: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    operators: async (_, { status, limit, offset }) => {
      const query = {};
      if (status) query.status = status;
      return Operator.find(query).sort({ code: 1 }).skip(offset || 0).limit(limit || 100);
    },
    operator: async (_, { id }) => Operator.findById(id),
    operatorByCode: async (_, { code }) => Operator.findOne({ code }),
    operatorCount: async () => Operator.countDocuments({}),
  },

  Mutation: {
    createOperator: async (_, { input }) => {
      return new Operator({ ...input, createdAt: new Date(), updatedAt: new Date() }).save();
    },
    updateOperator: async (_, { id, input }) => {
      return Operator.findByIdAndUpdate(id, { $set: { ...input, updatedAt: new Date() } }, { new: true });
    },
    deleteOperator: async (_, { id }) => {
      return (await Operator.findByIdAndDelete(id)) ? true : false;
    },
  },
};
