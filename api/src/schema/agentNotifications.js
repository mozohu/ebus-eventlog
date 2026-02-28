import mongoose from 'mongoose';

// agent_chat_logs — P2P 通訊紀錄 (MQTT agents/p2p/{channel}/{type} → Node-RED → MongoDB)
const schema = new mongoose.Schema({
  topic: { type: String },
  channel: { type: String, required: true, index: true },
  type: { type: String, default: 'unknown' },
  ts: { type: Date, default: Date.now },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'agent_chat_logs' });

schema.index({ channel: 1, ts: -1 });
schema.index({ ts: -1 });
schema.index({ channel: 1, type: 1 });

const AgentChatLog = mongoose.model('AgentChatLog', schema);

export const typeDefs = `#graphql
  type AgentChatLog {
    id: ID!
    channel: String!
    type: String!
    ts: String!
    payload: JSON
    createdAt: String!
  }
`;

export const resolvers = {
  AgentChatLog: {
    id: (p) => p._id.toString(),
    ts: (p) => p.ts instanceof Date ? p.ts.toISOString() : (p.ts ? new Date(p.ts).toISOString() : null),
    createdAt: (p) => p.createdAt instanceof Date ? p.createdAt.toISOString() : (p.createdAt ? new Date(p.createdAt).toISOString() : null),
  },

  Query: {
    agentChatLogs: async (_, { channel, type, limit }) => {
      const match = {};
      if (channel) match.channel = channel;
      if (type) match.type = type;
      return AgentChatLog.find(match).sort({ ts: -1 }).limit(limit || 50);
    },
    agentNotifications: async (_, { agentId, level, limit }) => {
      const match = { type: 'notify' };
      if (agentId) match.channel = { $regex: agentId };
      if (level) match['payload.level'] = level;
      return AgentChatLog.find(match).sort({ ts: -1 }).limit(limit || 50);
    },
  },
};
