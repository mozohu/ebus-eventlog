import mongoose from 'mongoose';

const heartbeatSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  temperature: { type: Number, default: null },
  screenshotUrl: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  receivedAt: { type: Date, default: Date.now },
}, { collection: 'heartbeats' });

heartbeatSchema.index({ deviceId: 1, receivedAt: -1 });

const Heartbeat = mongoose.model('Heartbeat', heartbeatSchema);

// Drop legacy unique index on deviceId if present
Heartbeat.collection.dropIndex('deviceId_1').catch(() => {});

export const typeDefs = `#graphql
  type Heartbeat {
    id: ID!
    deviceId: String!
    temperature: Float
    screenshotUrl: String
    payload: JSON
    receivedAt: String
  }

  input CreateHeartbeatInput {
    deviceId: String!
    temperature: Float
    payload: JSON
  }
`;

export const resolvers = {
  Heartbeat: {
    id: (parent) => parent._id.toString(),
  },

  Query: {
    heartbeats: async (_, { deviceIds }) => {
      const match = {};
      if (deviceIds && deviceIds.length > 0) match.deviceId = { $in: deviceIds };
      // Return latest heartbeat per device
      return Heartbeat.aggregate([
        { $match: match },
        { $sort: { receivedAt: -1 } },
        { $group: { _id: '$deviceId', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { deviceId: 1 } },
      ]);
    },
    heartbeat: async (_, { deviceId }) => {
      return Heartbeat.findOne({ deviceId }).sort({ receivedAt: -1 });
    },
    heartbeatHistory: async (_, { deviceId, limit }) => {
      return Heartbeat.find({ deviceId }).sort({ receivedAt: -1 }).limit(limit || 100);
    },
  },

  Mutation: {
    createHeartbeat: async (_, { input }) => {
      const hb = new Heartbeat({
        deviceId: input.deviceId,
        temperature: input.temperature ?? null,
        payload: input.payload || {},
        receivedAt: new Date(),
      });
      return hb.save();
    },
  },
};
