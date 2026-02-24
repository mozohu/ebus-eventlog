import mongoose from 'mongoose';

const PaymentMethod = mongoose.model('PaymentMethod', new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
}, { collection: 'paymentMethods' }));

// In-memory cache (refreshed every 5 min)
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function getPaymentMethodMap() {
  if (cache && Date.now() - cacheAt < CACHE_TTL) return cache;
  const docs = await PaymentMethod.find({}).lean();
  const map = {};
  for (const d of docs) map[d.key] = d.name;
  cache = map;
  cacheAt = Date.now();
  return map;
}

export const typeDefs = `#graphql
  type PaymentMethodEntry {
    key: String!
    name: String!
  }

  extend type Query {
    paymentMethods: [PaymentMethodEntry!]!
  }
`;

export const resolvers = {
  Query: {
    paymentMethods: async () => {
      return PaymentMethod.find({}).sort({ key: 1 }).lean();
    },
  },
};
