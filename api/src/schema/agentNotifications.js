import mongoose from 'mongoose';

// agent_notifications — Agent 通報紀錄 (MQTT agents/+/notify → Node-RED → MongoDB)
const schema = new mongoose.Schema({
  agentId: { type: String, required: true, index: true },
  level: { type: String, default: 'info' },      // info, warn, error, critical
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  tags: { type: [String], default: [] },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'agent_notifications' });

schema.index({ agentId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });
schema.index({ level: 1 });

const AgentNotification = mongoose.model('AgentNotification', schema);

export const typeDefs = `#graphql
  type AgentNotification {
    id: ID!
    agentId: String!
    level: String!
    title: String
    message: String
    tags: [String!]
    meta: JSON
    createdAt: String!
  }
`;

export const resolvers = {
  AgentNotification: {
    id: (p) => p._id.toString(),
    createdAt: (p) => p.createdAt instanceof Date
      ? p.createdAt.toISOString()
      : (p.createdAt ? new Date(p.createdAt).toISOString() : null),
  },

  Query: {
    agentNotifications: async (_, { agentId, level, limit }) => {
      const match = {};
      if (agentId) match.agentId = agentId;
      if (level) match.level = level;
      return AgentNotification.find(match)
        .sort({ createdAt: -1 })
        .limit(limit || 50);
    },
  },
};
