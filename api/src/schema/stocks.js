import mongoose from 'mongoose';

const stockSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
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
    channels: [StockChannel!]!
    updatedAt: String
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
  },
};
