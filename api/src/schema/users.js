import mongoose from 'mongoose';

// ============================================================
// Mongoose Model
// ============================================================

const operatorRoleSchema = new mongoose.Schema({
  operatorId: { type: String, required: true },
  // 營運商層級角色：operator（營運管理）、replenisher（巡補員）
  roles: { type: [String], default: [] },
}, { _id: false });

const userSchema = new mongoose.Schema({
  lineUserId: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, default: '' },
  pictureUrl: { type: String, default: '' },
  // 全域角色
  isAdmin: { type: Boolean, default: false },
  // 每個所屬營運商的角色
  operatorRoles: { type: [operatorRoleSchema], default: [] },
  lastLoginAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'users' });

userSchema.pre('save', function () { this.updatedAt = new Date(); });

const User = mongoose.model('User', userSchema);

// ============================================================
// GraphQL typeDefs
// ============================================================

export const typeDefs = `#graphql
  type OperatorRole {
    operatorId: String!
    roles: [String!]!
  }

  type User {
    id: ID!
    lineUserId: String!
    displayName: String!
    pictureUrl: String
    isAdmin: Boolean!
    operatorRoles: [OperatorRole!]!
    lastLoginAt: String
    createdAt: String
    updatedAt: String
  }

  input UpsertUserInput {
    lineUserId: String!
    displayName: String!
    pictureUrl: String
  }

  input OperatorRoleInput {
    operatorId: String!
    roles: [String!]!
  }

  input UpdateUserOperatorRolesInput {
    lineUserId: String!
    isAdmin: Boolean!
    operatorRoles: [OperatorRoleInput!]!
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  User: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    users: async (_, { limit, offset }) => {
      return User.find({})
        .sort({ lastLoginAt: -1 })
        .skip(offset || 0)
        .limit(limit || 100);
    },
    user: async (_, { lineUserId }) => {
      return User.findOne({ lineUserId });
    },
    userCount: async () => User.countDocuments({}),
    usersByOperator: async (_, { operatorId }) => {
      return User.find({ 'operatorRoles.operatorId': operatorId }).sort({ displayName: 1 });
    },
  },

  Mutation: {
    upsertUser: async (_, { input }) => {
      const { lineUserId, displayName, pictureUrl } = input;
      return User.findOneAndUpdate(
        { lineUserId },
        {
          $set: {
            displayName,
            pictureUrl: pictureUrl || '',
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
            isAdmin: false,
            operatorRoles: [],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    },

    updateUserOperatorRoles: async (_, { input }) => {
      const { lineUserId, isAdmin, operatorRoles } = input;
      const validRoles = ['operator', 'replenisher'];
      const cleaned = operatorRoles
        .map(or => ({
          operatorId: or.operatorId,
          roles: or.roles.filter(r => validRoles.includes(r)),
        }))
        .filter(or => or.roles.length > 0);

      return User.findOneAndUpdate(
        { lineUserId },
        { $set: { isAdmin: !!isAdmin, operatorRoles: cleaned, updatedAt: new Date() } },
        { new: true }
      );
    },
  },
};
