import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { requireAuth, requireAdmin } from '../auth.js';

// ============================================================
// Mongoose Model
// ============================================================

const invitationSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, default: () => randomUUID() },
  // 建立時指定的權限：加入後自動授予
  isAdmin: { type: Boolean, default: false },
  operatorRoles: [{
    operatorId: { type: String, required: true },
    roles: { type: [String], default: [] },
  }],
  // 使用狀態
  usedBy: { type: String, default: null },        // lineUserId
  usedByName: { type: String, default: null },     // displayName
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'invitations' });

const Invitation = mongoose.model('Invitation', invitationSchema);

// User model (reuse)
const User = mongoose.models.User;

// ============================================================
// GraphQL typeDefs
// ============================================================

export const typeDefs = `#graphql
  type Invitation {
    id: ID!
    code: String!
    isAdmin: Boolean!
    operatorRoles: [OperatorRole!]!
    usedBy: String
    usedByName: String
    usedAt: String
    createdAt: String!
  }

  input InvitationOperatorRoleInput {
    operatorId: String!
    roles: [String!]!
  }

  input CreateInvitationInput {
    isAdmin: Boolean
    operatorRoles: [InvitationOperatorRoleInput!]
  }

  input UpdateInvitationInput {
    id: ID!
    isAdmin: Boolean
    operatorRoles: [InvitationOperatorRoleInput!]
  }

  type RedeemInvitationResult {
    success: Boolean!
    message: String!
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  Invitation: {
    id: (p) => p._id.toString(),
    createdAt: (p) => p.createdAt?.toISOString(),
    usedAt: (p) => p.usedAt?.toISOString() || null,
  },

  Query: {
    invitations: async (_, _args, { user }) => {
      requireAdmin(user);
      return Invitation.find({}).sort({ createdAt: -1 });
    },
  },

  Mutation: {
    createInvitation: async (_, { input }, { user }) => {
      requireAdmin(user);
      const { isAdmin, operatorRoles } = input || {};
      const validRoles = ['operator', 'replenisher'];
      const cleaned = (operatorRoles || [])
        .map(or => ({
          operatorId: or.operatorId,
          roles: or.roles.filter(r => validRoles.includes(r)),
        }))
        .filter(or => or.roles.length > 0);

      return Invitation.create({
        isAdmin: !!isAdmin,
        operatorRoles: cleaned,
      });
    },

    updateInvitation: async (_, { input }, { user }) => {
      requireAdmin(user);
      const inv = await Invitation.findById(input.id);
      if (!inv) throw new Error('邀請碼不存在');
      if (inv.usedBy) throw new Error('已使用的邀請碼無法編輯');
      const validRoles = ['operator', 'replenisher'];
      const cleaned = (input.operatorRoles || [])
        .map(or => ({ operatorId: or.operatorId, roles: or.roles.filter(r => validRoles.includes(r)) }))
        .filter(or => or.roles.length > 0);
      inv.isAdmin = !!input.isAdmin;
      inv.operatorRoles = cleaned;
      await inv.save();
      return inv;
    },

    deleteInvitation: async (_, { id }, { user }) => {
      requireAdmin(user);
      const inv = await Invitation.findById(id);
      if (!inv) throw new Error('邀請碼不存在');
      await Invitation.deleteOne({ _id: id });
      return true;
    },

    redeemInvitation: async (_, { code }, { user }) => {
      requireAuth(user);

      const inv = await Invitation.findOne({ code });
      if (!inv) return { success: false, message: '邀請碼無效' };
      if (inv.usedBy) {
        if (inv.usedBy === user.lineUserId) {
          return { success: false, message: '您已使用過此邀請碼' };
        }
        return { success: false, message: '此邀請碼已被使用' };
      }

      // 找到或建立 user
      let dbUser = await User.findOne({ lineUserId: user.lineUserId });
      if (!dbUser) {
        dbUser = await User.create({
          lineUserId: user.lineUserId,
          displayName: user.displayName || '',
          pictureUrl: user.pictureUrl || '',
        });
      }

      // 合併權限
      if (inv.isAdmin) {
        dbUser.isAdmin = true;
      }
      for (const invRole of inv.operatorRoles) {
        const existing = dbUser.operatorRoles.find(r => r.operatorId === invRole.operatorId);
        if (existing) {
          // 合併 roles（不重複）
          const merged = new Set([...existing.roles, ...invRole.roles]);
          existing.roles = [...merged];
        } else {
          dbUser.operatorRoles.push({
            operatorId: invRole.operatorId,
            roles: [...invRole.roles],
          });
        }
      }
      dbUser.updatedAt = new Date();
      await dbUser.save();

      // 標記邀請碼已使用
      inv.usedBy = user.lineUserId;
      inv.usedByName = user.displayName || dbUser.displayName || '';
      inv.usedAt = new Date();
      await inv.save();

      return { success: true, message: '加入成功！權限已更新' };
    },
  },
};
