import mongoose from 'mongoose';

// 每台機台只保留最新一筆心跳（由 Node-RED upsert）
const heartbeatSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  temperature: { type: Number, default: null },
  screenshotUrl: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },  // 完整心跳 payload
  receivedAt: { type: Date, default: Date.now },
}, { collection: 'heartbeats' });

const Heartbeat = mongoose.model('Heartbeat', heartbeatSchema);

export const typeDefs = `#graphql
  type Heartbeat {
    id: ID!
    deviceId: String!
    temperature: Float
    screenshotUrl: String
    payload: JSON
    receivedAt: String
  }
`;

export const resolvers = {
  Heartbeat: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    heartbeats: async (_, { deviceIds }) => {
      const query = {};
      if (deviceIds && deviceIds.length > 0) query.deviceId = { $in: deviceIds };
      return Heartbeat.find(query).sort({ deviceId: 1 });
    },
    heartbeat: async (_, { deviceId }) => {
      return Heartbeat.findOne({ deviceId });
    },
  },
};
