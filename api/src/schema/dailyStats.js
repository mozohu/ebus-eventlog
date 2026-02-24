import mongoose from 'mongoose'
import { requireAuth } from '../auth.js'

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
    byMethod: [MethodStat!]
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
    revenue: Float
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
    async dailyRevenue(_, { deviceIds, from, to }, { user }) {
      requireAuth(user);
      const filter = {}
      if (deviceIds && deviceIds.length) filter.deviceId = { $in: deviceIds }
      if (from || to) {
        filter.date = {}
        if (from) filter.date.$gte = from
        if (to) filter.date.$lte = to
      }

      // Fetch raw docs and merge by date (to preserve byMethod)
      const docs = await DailyStat.find(filter).sort({ date: 1 }).lean()
      const map = new Map()
      for (const doc of docs) {
        if (!map.has(doc.date)) {
          map.set(doc.date, { date: doc.date, revenue: 0, txCount: 0, successCount: 0, byMethod: {} })
        }
        const m = map.get(doc.date)
        m.revenue += doc.revenue || 0
        m.txCount += doc.txCount || 0
        m.successCount += doc.successCount || 0
        if (doc.byMethod) {
          for (const [method, val] of Object.entries(doc.byMethod)) {
            if (!m.byMethod[method]) m.byMethod[method] = { count: 0, revenue: 0 }
            if (typeof val === 'number') {
              // Legacy format: byMethod.cash = 5 (count only)
              m.byMethod[method].count += val
            } else if (val && typeof val === 'object') {
              // New format: byMethod.cash = { count, revenue }
              m.byMethod[method].count += val.count || 0
              m.byMethod[method].revenue += val.revenue || 0
            }
          }
        }
      }
      return Array.from(map.values()).map(m => ({
        ...m,
        byMethod: Object.entries(m.byMethod).map(([method, v]) => ({ method, count: v.count, revenue: v.revenue })),
      }))
    },

    async dailyStatsDetail(_, { deviceIds, from, to }, { user }) {
      requireAuth(user);
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
          for (const [method, val] of Object.entries(doc.byMethod)) {
            if (!m.byMethod[method]) m.byMethod[method] = { count: 0, revenue: 0 }
            if (typeof val === 'number') {
              m.byMethod[method].count += val
            } else if (val && typeof val === 'object') {
              m.byMethod[method].count += val.count || 0
              m.byMethod[method].revenue += val.revenue || 0
            }
          }
        }
      }

      return Array.from(map.values()).map(m => ({
        ...m,
        byProduct: Object.values(m.byProduct),
        byMethod: Object.entries(m.byMethod).map(([method, v]) => ({ method, count: v.count, revenue: v.revenue })),
      }))
    }
  }
}

