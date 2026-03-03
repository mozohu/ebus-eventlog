import mongoose from 'mongoose';

// heartbeats collection — 設備狀態心跳 (sys/hint {heartbeat})
const heartbeatSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  status: { type: String, default: null },
  stat: { type: String, default: null },
  content: { type: String, default: null },
  occurredAt: { type: String, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  receivedAt: { type: Date, default: Date.now },
}, { collection: 'heartbeats' });

heartbeatSchema.index({ deviceId: 1, receivedAt: -1 });

const Heartbeat = mongoose.model('Heartbeat', heartbeatSchema);

// tempreports collection — 溫度報告 (sys/hint {tempreport})
const tempreportSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  temperature: { type: Number, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  receivedAt: { type: Date, default: Date.now },
}, { collection: 'tempreports' });

tempreportSchema.index({ deviceId: 1, receivedAt: -1 });

const Tempreport = mongoose.model('Tempreport', tempreportSchema);

// scale → collection mapping for temperature buckets
const scaleCollections = {
  day: 'temp_5min',
  week: 'temp_30min',
  month: 'temp_2hr',
};

export const typeDefs = `#graphql
  type Heartbeat {
    id: ID!
    deviceId: String!
    status: String
    stat: String
    content: String
    occurredAt: String
    payload: JSON
    receivedAt: String
  }

  type TemperatureRecord {
    id: ID!
    deviceId: String!
    temperature: Float
    receivedAt: String
  }

  type LatestTemp {
    deviceId: String!
    temperature: Float
  }

  type TempBucket {
    bucket: String!
    deviceId: String!
    avgTemp: Float
    minTemp: Float
    maxTemp: Float
    count: Int
  }

  input CreateHeartbeatInput {
    deviceId: String!
    payload: JSON
  }
`;

export const resolvers = {
  Heartbeat: {
    id: (parent) => parent._id.toString(),
    receivedAt: (parent) => parent.receivedAt instanceof Date
      ? parent.receivedAt.toISOString()
      : (parent.receivedAt ? new Date(parent.receivedAt).toISOString() : null),
  },

  TemperatureRecord: {
    id: (parent) => parent._id.toString(),
    receivedAt: (parent) => parent.receivedAt instanceof Date
      ? parent.receivedAt.toISOString()
      : (parent.receivedAt ? new Date(parent.receivedAt).toISOString() : null),
  },

  Query: {
    heartbeats: async (_, { deviceIds }) => {
      const match = {};
      if (deviceIds && deviceIds.length > 0) match.deviceId = { $in: deviceIds };
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
    tempHistory: async (_, { deviceId, limit }) => {
      return Tempreport.find({ deviceId }).sort({ receivedAt: -1 }).limit(limit || 1440);
    },
    latestTemps: async () => {
      return Tempreport.aggregate([
        { $sort: { receivedAt: -1 } },
        { $group: { _id: '$deviceId', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $project: { deviceId: 1, temperature: 1 } },
      ]);
    },
    tempBuckets: async (_, { deviceId, scale }) => {
      const collName = scaleCollections[scale] || 'temp_5min';
      const coll = mongoose.connection.db.collection(collName);
      return coll.find({ deviceId }).sort({ bucket: 1 }).toArray();
    },
  },

  Mutation: {
    createHeartbeat: async (_, { input }) => {
      const hb = new Heartbeat({
        deviceId: input.deviceId,
        payload: input.payload || {},
        receivedAt: new Date(),
      });
      return hb.save();
    },
  },
};
