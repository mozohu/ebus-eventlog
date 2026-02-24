import mongoose from 'mongoose'
import { requireAuth } from '../auth.js'

// Use existing models (already compiled in other schema files)
const Trigger = mongoose.models.Trigger
const VendSession = mongoose.models.VendSession
const VendTransaction = mongoose.models.VendTransaction

export const typeDefs = `#graphql
  type TimelineEvent {
    timestamp: String!
    receivedAt: String!
    event: String!
    stateMachine: String!
    trigger: String!
    state: String
    arg: JSON
    can: Int
  }

  type SessionInfo {
    sid: String!
    deviceId: String!
    startedAt: String
    endedAt: String
    status: String
  }

  type TransactionInfo {
    txno: String!
    sid: String
    oid: String
    startedAt: String
    endedAt: String
    status: String
    productName: String
    price: Float
    paymentMethod: String
    dispenseSuccess: Boolean
    dispenseChannel: String
    dispenseElapsed: Int
    invoiceNo: String
    invoiceRandom: String
    refundStatus: String
  }

  type SessionTimeline {
    session: SessionInfo
    transaction: TransactionInfo
    events: [TimelineEvent!]!
  }

  extend type Query {
    sessionTimeline(txno: String!): SessionTimeline
  }
`

export const resolvers = {
  Query: {
    async sessionTimeline(_, { txno }, { user }) {
      requireAuth(user);
      // Find transaction
      // txno may be string or number in MongoDB — query both forms to handle mixed types
      const txnoNum = Number(txno)
      const txQuery = isNaN(txnoNum) ? { txno } : { txno: { $in: [txno, txnoNum] } }
      const tx = await VendTransaction.collection.findOne(txQuery)
      if (!tx) return null

      // Find session
      const session = tx.sid ? await VendSession.findOne({ sid: tx.sid }).lean() : null

      // Determine time range from session or transaction
      const start = session?.startedAt || tx.startedAt
      const end = session?.endedAt || tx.endedAt
      if (!start || !end) return null

      // Get all triggers in this time window (skip invalid can=0 triggers)
      const triggers = await Trigger.find({
        deviceId: tx.deviceId,
        receivedAt: { $gte: start, $lte: end },
        can: { $ne: 0 }
      }).sort({ receivedAt: 1 }).lean()

      const events = triggers.map(t => ({
        timestamp: String(t.timestamp),
        receivedAt: t.receivedAt?.toISOString?.() || String(t.receivedAt),
        event: t.e || '',
        stateMachine: t.sm || '',
        trigger: t.trigger || t.e?.split('/')[1] || '',
        state: t.st || '',
        arg: t.arg || {},
        can: t.can ?? null,
      }))

      const transaction = {
        txno: tx.txno,
        sid: tx.sid,
        oid: tx.oid,
        startedAt: tx.startedAt?.toISOString?.() || String(tx.startedAt || ''),
        endedAt: tx.endedAt?.toISOString?.() || String(tx.endedAt || ''),
        status: tx.status,
        productName: tx.payment?.hint?.p_name || '',
        price: tx.payment?.hint?.price || 0,
        paymentMethod: tx.arg?.method || '',
        dispenseSuccess: tx.dispense?.success ?? null,
        dispenseChannel: tx.dispense?.ready?.chid || '',
        dispenseElapsed: tx.dispense?.elapsed || null,
        invoiceNo: tx.invoice?.got_invoice_no?.eino || null,
        invoiceRandom: tx.invoice?.got_invoice_no?.rand || null,
        refundStatus: tx.payment?.refund?.success === true ? 'refunded'
          : tx.payment?.refund?.startedAt ? 'refund_pending'
          : null,
      }

      const sessionInfo = session ? {
        sid: session.sid,
        deviceId: session.deviceId,
        startedAt: session.startedAt?.toISOString?.() || '',
        endedAt: session.endedAt?.toISOString?.() || '',
        status: session.status,
      } : null

      return { session: sessionInfo, transaction, events }
    }
  }
}
