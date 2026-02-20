import mongoose from 'mongoose';

// ============================================================
// Mongoose Schema
// ============================================================

const ticketMessageSchema = new mongoose.Schema({
  from: { type: String, enum: ['consumer', 'operator'], required: true },
  displayName: String,
  text: String,
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  lineUserId: { type: String, required: true, index: true },
  displayName: String,
  operatorId: { type: String, required: true, index: true },
  vmid: String,
  category: { type: String, enum: ['product_issue', 'machine_issue', 'payment_issue', 'other'], default: 'other' },
  subject: { type: String, required: true },
  description: String,
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  messages: [ticketMessageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
}, { collection: 'tickets' });

const Ticket = mongoose.model('Ticket', ticketSchema);

// ============================================================
// Helpers
// ============================================================

function generateTicketId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `TK-${date}-${rand}`;
}

// ============================================================
// GraphQL TypeDefs
// ============================================================

export const typeDefs = `#graphql
  type TicketMessage {
    from: String!
    displayName: String
    text: String!
    createdAt: Float
  }

  type Ticket {
    ticketId: String!
    lineUserId: String!
    displayName: String
    operatorId: String!
    vmid: String
    category: String!
    subject: String!
    description: String
    status: String!
    messages: [TicketMessage!]!
    createdAt: Float
    updatedAt: Float
    resolvedAt: Float
  }

  input CreateTicketInput {
    lineUserId: String!
    displayName: String!
    operatorId: String
    vmid: String!
    category: String!
    subject: String!
    description: String!
  }
`;

// ============================================================
// Resolvers
// ============================================================

export const resolvers = {
  Query: {
    myTickets: async (_, { lineUserId }) => {
      return Ticket.find({ lineUserId }).sort({ updatedAt: -1 }).lean();
    },

    ticket: async (_, { ticketId }) => {
      return Ticket.findOne({ ticketId }).lean();
    },

    operatorTickets: async (_, { operatorId, status }) => {
      const query = { operatorId };
      if (status) query.status = status;
      return Ticket.find(query).sort({ updatedAt: -1 }).lean();
    },
  },

  Mutation: {
    createTicket: async (_, { input }) => {
      const now = new Date();
      // Resolve operatorId from vmid
      let operatorId = input.operatorId;
      if (!operatorId && input.vmid) {
        const Vm = mongoose.model('Vm');
        const vm = await Vm.findOne({ vmid: input.vmid }).lean();
        if (!vm) throw new Error(`找不到機台: ${input.vmid}`);
        operatorId = vm.operatorId;
      }
      if (!operatorId) throw new Error('無法判定營運商');
      const ticket = await Ticket.create({
        ticketId: generateTicketId(),
        lineUserId: input.lineUserId,
        displayName: input.displayName,
        operatorId,
        vmid: input.vmid,
        category: input.category,
        subject: input.subject,
        description: input.description,
        status: 'open',
        messages: [{
          from: 'consumer',
          displayName: input.displayName,
          text: input.description,
          createdAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      });
      return ticket.toObject();
    },

    replyTicket: async (_, { ticketId, from, displayName, text }) => {
      const now = new Date();
      const ticket = await Ticket.findOneAndUpdate(
        { ticketId },
        {
          $push: { messages: { from, displayName, text, createdAt: now } },
          $set: { updatedAt: now },
        },
        { new: true }
      );
      if (!ticket) throw new Error('Ticket not found');
      return ticket.toObject();
    },

    updateTicketStatus: async (_, { ticketId, status }) => {
      const update = { status, updatedAt: new Date() };
      if (status === 'resolved' || status === 'closed') {
        update.resolvedAt = new Date();
      }
      const ticket = await Ticket.findOneAndUpdate(
        { ticketId },
        { $set: update },
        { new: true }
      );
      if (!ticket) throw new Error('Ticket not found');
      return ticket.toObject();
    },
  },
};
