import mongoose from 'mongoose'

const DailyStat = mongoose.model('DailyStat', new mongoose.Schema({
  deviceId: String,
  date: String,        // YYYY-MM-DD
  revenue: Number,
  txCount: Number,
  successCount: Number,
  byProduct: mongoose.Schema.Types.Mixed,
  byMethod: mongoose.Schema.Types.Mixed,
  createdAt: Date,
  updatedAt: Date,
}, { collection: 'daily_stats' }))

export const typeDefs = `#graphql
  type DailyStatPoint {
    date: String!
    revenue: Float!
    txCount: Int!
    successCount: Int!
  }

  type ProductStat {
    productId: String!
    name: String
    qty: Int!
    revenue: Float!
  }

  type MethodStat {
    method: String!
    count: Int!
  }

  type DailyStatDetail {
    date: String!
    revenue: Float!
    txCount: Int!
    successCount: Int!
    byProduct: [ProductStat!]
    byMethod: [MethodStat!]
  }

  extend type Query {
    dailyRevenue(deviceIds: [String!], from: String, to: String): [DailyStatPoint!]!
    dailyStatsDetail(deviceIds: [String!], from: String, to: String): [DailyStatDetail!]!
  }
`

export const resolvers = {
  Query: {
    async dailyRevenue(_, { deviceIds, from, to }) {
      const filter = {}
      if (deviceIds && deviceIds.length) filter.deviceId = { $in: deviceIds }
      if (from || to) {
        filter.date = {}
        if (from) filter.date.$gte = from
        if (to) filter.date.$lte = to
      }

      // Aggregate across devices by date
      const pipeline = [
        { $match: filter },
        { $group: {
          _id: '$date',
          revenue: { $sum: '$revenue' },
          txCount: { $sum: '$txCount' },
          successCount: { $sum: '$successCount' },
        }},
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', revenue: 1, txCount: 1, successCount: 1 } }
      ]
      return DailyStat.aggregate(pipeline)
    },

    async dailyStatsDetail(_, { deviceIds, from, to }) {
      const filter = {}
      if (deviceIds && deviceIds.length) filter.deviceId = { $in: deviceIds }
      if (from || to) {
        filter.date = {}
        if (from) filter.date.$gte = from
        if (to) filter.date.$lte = to
      }

      const docs = await DailyStat.find(filter).sort({ date: 1 }).lean()

      // Merge by date
      const map = new Map()
      for (const doc of docs) {
        if (!map.has(doc.date)) {
          map.set(doc.date, { date: doc.date, revenue: 0, txCount: 0, successCount: 0, byProduct: {}, byMethod: {} })
        }
        const m = map.get(doc.date)
        m.revenue += doc.revenue || 0
        m.txCount += doc.txCount || 0
        m.successCount += doc.successCount || 0
        // Merge byProduct
        if (doc.byProduct) {
          for (const [pid, val] of Object.entries(doc.byProduct)) {
            if (!m.byProduct[pid]) m.byProduct[pid] = { productId: pid, name: val.name || '', qty: 0, revenue: 0 }
            m.byProduct[pid].qty += val.qty || 0
            m.byProduct[pid].revenue += val.revenue || 0
          }
        }
        // Merge byMethod
        if (doc.byMethod) {
          for (const [method, count] of Object.entries(doc.byMethod)) {
            m.byMethod[method] = (m.byMethod[method] || 0) + count
          }
        }
      }

      return Array.from(map.values()).map(m => ({
        ...m,
        byProduct: Object.values(m.byProduct),
        byMethod: Object.entries(m.byMethod).map(([method, count]) => ({ method, count })),
      }))
    }
  }
}

