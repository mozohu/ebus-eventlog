import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  operatorId: { type: String, required: true, index: true },
  code: { type: String, required: true },           // 商品編號
  name: { type: String, required: true },            // 商品名稱
  price: { type: Number, required: true },           // 售價
  barcode: { type: String, default: '' },            // 條碼
  imageUrl: { type: String, default: '' },           // 商品圖片 URL
  status: { type: String, default: 'active' },       // active=上架, inactive=下架
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'products' });

// 同一營運商下商品編號唯一
productSchema.index({ operatorId: 1, code: 1 }, { unique: true });

productSchema.pre('save', function () { this.updatedAt = new Date(); });

const Product = mongoose.model('Product', productSchema);

export const typeDefs = `#graphql
  type Product {
    id: ID!
    operatorId: String!
    code: String!
    name: String!
    price: Float!
    barcode: String
    imageUrl: String
    status: String!
    notes: String
    createdAt: String
    updatedAt: String
  }

  input CreateProductInput {
    operatorId: String!
    code: String!
    name: String!
    price: Float!
    barcode: String
    imageUrl: String
    status: String
    notes: String
  }

  input UpdateProductInput {
    name: String
    price: Float
    barcode: String
    imageUrl: String
    status: String
    notes: String
  }
`;

export const resolvers = {
  Product: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    products: async (_, { operatorId, status, limit, offset }) => {
      const query = {};
      if (operatorId) query.operatorId = operatorId;
      if (status) query.status = status;
      return Product.find(query).sort({ code: 1 }).skip(offset || 0).limit(limit || 200);
    },
    product: async (_, { id }) => Product.findById(id),
    productByCode: async (_, { operatorId, code }) => Product.findOne({ operatorId, code }),
    productCount: async (_, { operatorId }) => {
      const query = {};
      if (operatorId) query.operatorId = operatorId;
      return Product.countDocuments(query);
    },
  },

  Mutation: {
    createProduct: async (_, { input }) => {
      return new Product({ ...input, createdAt: new Date(), updatedAt: new Date() }).save();
    },
    updateProduct: async (_, { id, input }) => {
      return Product.findByIdAndUpdate(id, { $set: { ...input, updatedAt: new Date() } }, { new: true });
    },
    deleteProduct: async (_, { id }) => {
      return (await Product.findByIdAndDelete(id)) ? true : false;
    },
  },
};
