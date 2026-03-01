#!/usr/bin/env node
/**
 * Offline Replay Projector
 * 
 * Reads ebus_log.sqlite files, replays trigger events through the projector
 * state machine, and writes sessions/orders/transactions/daily_stats to MongoDB.
 * 
 * Usage: node replay-projector.js <deviceId> <sqliteDir> [replayBatch]
 * Example: node replay-projector.js 8c147dd48d16 /tmp/court-replay court_v1
 */

const Database = require('better-sqlite3');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const DEVICE_ID = process.argv[2];
const SQLITE_DIR = process.argv[3];
const REPLAY_BATCH = process.argv[4] || 'v1';
const MONGO_URI = 'mongodb://admin:ebus2026@localhost:27017/ebus?authSource=admin';

if (!DEVICE_ID || !SQLITE_DIR) {
  console.error('Usage: node replay-projector.js <deviceId> <sqliteDir> [replayBatch]');
  process.exit(1);
}

// ── Projector State Machine (ported from Node-RED) ──

class Projector {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.state = {};
    this.ops = [];
  }

  genId(prefix, ts) {
    const sec = Math.floor(ts > 1e15 ? ts / 1e6 : ts > 1e12 ? ts / 1e3 : ts);
    return prefix + '-' + sec;
  }

  process(trigger) {
    const deviceId = this.deviceId;
    const e = trigger.e || '';
    const arg = trigger.arg || {};
    const can = trigger.can;
    const ts = trigger.timestamp;
    const receivedAt = new Date(ts > 1e15 ? ts / 1000 : ts > 1e12 ? ts : ts * 1000);
    const state = this.state;

    if (can === 0) return;

    const sm = e.split('/')[0];
    const trig = e.split('/')[1];
    const self = this;

    function closeTxno(reason) {
      if (state.currentTxno) {
        self.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: { endedAt: receivedAt, status: reason || 'closed' } }
        });
        state.currentTxno = null;
      }
    }

    function closeOrder(reason) {
      closeTxno(reason);
      if (state.currentOid) {
        self.ops.push({
          collection: 'orders', op: 'updateOne',
          filter: { oid: state.currentOid, deviceId },
          update: { $set: { endedAt: receivedAt, status: reason || 'closed' } }
        });
        state.currentOid = null;
      }
    }

    function closeSession(reason) {
      closeOrder(reason);
      if (state.currentSid) {
        self.ops.push({
          collection: 'sessions', op: 'updateOne',
          filter: { sid: state.currentSid },
          update: { $set: { endedAt: receivedAt, status: reason || 'ended' } }
        });
        state.currentSid = null;
      }
    }

    // ── sess ──
    if (sm === 'sess' && trig === 'session_begin') {
      closeSession('superseded');
      const sid = arg.sid || this.genId('sid', ts);
      state.currentSid = sid;
      this.ops.push({
        collection: 'sessions', op: 'updateOne',
        filter: { sid },
        update: {
          $set: { deviceId, sid, startedAt: receivedAt, status: 'active',
                  replayBatch: REPLAY_BATCH, source: 'replay' },
          $setOnInsert: { createdAt: receivedAt }
        },
        upsert: true
      });
    }
    else if (sm === 'sess' && trig === 'timeout') {
      closeSession('timeout');
    }

    // ── order ──
    else if (sm === 'order' && trig === 'ordered') {
      closeTxno('new_order');
      if (state.currentOid) {
        this.ops.push({
          collection: 'orders', op: 'updateOne',
          filter: { oid: state.currentOid, deviceId },
          update: { $set: { superseded: true, supersededAt: receivedAt } }
        });
      }
      const oid = arg.oid || this.genId('oid', ts);
      state.currentOid = oid;
      state.pendingPaymentHint = null;  // reset on new order
      this.ops.push({
        collection: 'orders', op: 'updateOne',
        filter: { oid },
        update: {
          $set: {
            deviceId, oid, sid: state.currentSid,
            orderedAt: receivedAt, arg,
            superseded: false, status: 'active',
            replayBatch: REPLAY_BATCH, source: 'replay'
          },
          $setOnInsert: { createdAt: receivedAt }
        },
        upsert: true
      });
    }
    else if (sm === 'order' && trig === 'hint') {
      if (state.currentOid) {
        const setObj = {};
        for (const [k, v] of Object.entries(arg)) setObj['hints.' + k] = v;
        setObj['hints.lastAt'] = receivedAt;
        this.ops.push({
          collection: 'orders', op: 'updateOne',
          filter: { oid: state.currentOid },
          update: { $set: setObj }
        });
        state.pendingPaymentHint = Object.assign(state.pendingPaymentHint || {}, arg);
      }
    }

    // ── payment ──
    else if (sm === 'payment' && trig === 'hint') {
      if (state.currentTxno) {
        const setObj = { 'payment.hintAt': receivedAt };
        for (const [k, v] of Object.entries(arg)) setObj['payment.hint.' + k] = v;
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: setObj }
        });
      } else if (state.currentOid) {
        const setObj = {};
        for (const [k, v] of Object.entries(arg)) setObj['paymentHint.' + k] = v;
        this.ops.push({
          collection: 'orders', op: 'updateOne',
          filter: { oid: state.currentOid },
          update: { $set: setObj }
        });
        state.pendingPaymentHint = Object.assign(state.pendingPaymentHint || {}, arg);
      }
    }
    else if (sm === 'payment' && trig === 'input') {
      if (arg.payment_method) {
        const methods = Object.keys(arg.payment_method);
        if (methods.length > 0) state.currentPaymentMethod = methods[0];
      }
      if (arg.method) state.currentPaymentMethod = arg.method;
    }
    else if (sm === 'payment' && trig === 'payment_begin') {
      const txno = arg.txno || this.genId('txno', ts);
      state.currentTxno = txno;
      state.currentPaymentMethod = arg.method || state.currentPaymentMethod || 'unknown';
      const txnSet = {
        deviceId, txno,
        sid: state.currentSid, oid: state.currentOid,
        startedAt: receivedAt, status: 'active', arg,
        replayBatch: REPLAY_BATCH, source: 'replay'
      };
      if (state.pendingPaymentHint) {
        txnSet['payment.hint'] = state.pendingPaymentHint;
        txnSet['payment.hintAt'] = receivedAt;
      }
      this.ops.push({
        collection: 'transactions', op: 'updateOne',
        filter: { txno },
        update: { $set: txnSet, $setOnInsert: { createdAt: receivedAt } },
        upsert: true
      });
    }
    else if (sm === 'payment' && trig === 'paid') {
      if (state.currentTxno) {
        const update = { 'payment.paidAt': receivedAt };
        for (const [k, v] of Object.entries(arg)) update['payment.hint.' + k] = v;
        if (arg.method) { state.currentPaymentMethod = arg.method; update['arg.method'] = arg.method; }
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: update }
        });
        // daily_stats
        const dateStr = receivedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        const hint = state.pendingPaymentHint || {};
        const price = hint.price || 0;
        const pId = hint.p_id || 'unknown';
        const pName = hint.p_name || '';
        const method = state.currentPaymentMethod || 'unknown';
        this.ops.push({
          collection: 'daily_stats', op: 'updateOne',
          filter: { deviceId, date: dateStr, replayBatch: REPLAY_BATCH },
          update: {
            $inc: {
              revenue: price, txCount: 1,
              ['byProduct.' + pId + '.qty']: 1,
              ['byProduct.' + pId + '.revenue']: price,
              ['byMethod.' + method + '.count']: 1,
              ['byMethod.' + method + '.revenue']: price
            },
            $set: {
              ['byProduct.' + pId + '.name']: pName,
              updatedAt: receivedAt, source: 'replay'
            },
            $setOnInsert: { createdAt: receivedAt }
          },
          upsert: true
        });
      }
    }
    else if (sm === 'payment' && trig === 'failed') {
      if (state.currentTxno) {
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: { status: 'failed', 'payment.failedAt': receivedAt, 'payment.failReason': arg } }
        });
      }
    }
    else if (sm === 'payment' && trig === 'refund') {
      if (state.currentTxno || arg.txno) {
        const txno = state.currentTxno || Number(arg.txno) || arg.txno;
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno },
          update: { $set: { 'payment.refund': { startedAt: receivedAt, arg }, status: 'refund' } }
        });
      }
    }
    else if (sm === 'payment' && (trig === 'cancelled' || trig === 'timeout')) {
      if (state.currentTxno) {
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: { status: trig, endedAt: receivedAt } }
        });
        state.currentTxno = null;
      }
    }

    // ── dispense ──
    else if (sm === 'dispense') {
      if (state.currentTxno) {
        const update = {};
        if (trig === 'prod_dispensed') {
          update['dispense.dispensedAt'] = receivedAt;
          update['dispense.success'] = true;
          const dateStr = receivedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
          this.ops.push({
            collection: 'daily_stats', op: 'updateOne',
            filter: { deviceId, date: dateStr, replayBatch: REPLAY_BATCH },
            update: {
              $inc: { successCount: 1 },
              $set: { updatedAt: receivedAt, source: 'replay' },
              $setOnInsert: { createdAt: receivedAt }
            },
            upsert: true
          });
        } else if (trig === 'hint' && arg.final) {
          update['dispense.finalHint'] = arg.info || '';
        } else if (trig === 'hint' && arg.elapsed !== undefined) {
          update['dispense.elapsed'] = arg.elapsed;
        } else if (trig === 'failed' || trig === 'error') {
          update['dispense.success'] = false;
          update['dispense.error'] = arg;
          update['status'] = 'dispense_failed';
        } else if (trig === 'ready') {
          update['dispense.ready'] = arg;
        }
        if (Object.keys(update).length > 0) {
          this.ops.push({
            collection: 'transactions', op: 'updateOne',
            filter: { txno: state.currentTxno },
            update: { $set: update }
          });
        }
      }
    }

    // ── invoice ──
    else if (sm === 'invoice') {
      if (state.currentTxno) {
        this.ops.push({
          collection: 'transactions', op: 'updateOne',
          filter: { txno: state.currentTxno },
          update: { $set: { ['invoice.' + trig]: arg, 'invoice.updatedAt': receivedAt } }
        });
      }
    }
  }
}

// ── Main ──

async function main() {
  const files = fs.readdirSync(SQLITE_DIR).filter(f => f.endsWith('.sqlite')).sort();
  console.log(`Device: ${DEVICE_ID}`);
  console.log(`Replay batch: ${REPLAY_BATCH}`);
  console.log(`SQLite files: ${files.length}`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('ebus');

  // Read all triggers
  console.log('\nReading triggers from SQLite...');
  let allTriggers = [];
  for (const f of files) {
    const sqlDb = new Database(path.join(SQLITE_DIR, f), { readonly: true });
    const rows = sqlDb.prepare("SELECT timestamp, e, arg, can FROM ebus_trigger ORDER BY timestamp").all();
    for (const row of rows) {
      const sm = (row.e || '').split('/')[0];
      if (!['sess','order','payment','dispense','invoice','freebie','reader'].includes(sm)) continue;
      let arg = {};
      try { arg = JSON.parse(row.arg || '{}'); } catch {}
      allTriggers.push({ timestamp: row.timestamp, e: row.e, arg, can: row.can });
    }
    sqlDb.close();
  }
  allTriggers.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`Transaction-related triggers: ${allTriggers.length}`);

  // Run projector
  console.log('\nRunning projector...');
  const projector = new Projector(DEVICE_ID);
  for (const t of allTriggers) projector.process(t);

  console.log(`Generated ${projector.ops.length} MongoDB operations`);
  const summary = {};
  for (const op of projector.ops) summary[op.collection] = (summary[op.collection] || 0) + 1;
  console.log('\nOperations by collection:');
  for (const [col, count] of Object.entries(summary)) console.log(`  ${col}: ${count}`);

  const txnos = new Set(projector.ops.filter(o => o.collection === 'transactions' && o.upsert).map(o => o.filter.txno));
  const sids = new Set(projector.ops.filter(o => o.collection === 'sessions' && o.upsert).map(o => o.filter.sid));
  const oids = new Set(projector.ops.filter(o => o.collection === 'orders' && o.upsert).map(o => o.filter.oid));
  console.log(`\nDistinct: sessions=${sids.size} orders=${oids.size} transactions=${txnos.size}`);

  // Write to MongoDB
  console.log('\nWriting to MongoDB...');
  let written = 0;
  for (const op of projector.ops) {
    const col = db.collection(op.collection);
    await col.updateOne(op.filter, op.update, { upsert: !!op.upsert });
    written++;
    if (written % 100 === 0) process.stdout.write(`\r  ${written}/${projector.ops.length}`);
  }
  console.log(`\r  ${written}/${projector.ops.length} done`);

  // Verify
  console.log('\n── Verification ──');
  for (const col of ['sessions','orders','transactions','daily_stats']) {
    const n = await db.collection(col).countDocuments({ replayBatch: REPLAY_BATCH });
    console.log(`${col}: ${n}`);
  }

  // Show transactions
  console.log('\n── Transactions ──');
  const txns = await db.collection('transactions').find({ replayBatch: REPLAY_BATCH }).sort({ startedAt: 1 }).toArray();
  for (const t of txns) {
    const hint = t.payment?.hint || {};
    const paid = t.payment?.paidAt ? '✅paid' : (t.status === 'failed' ? '❌fail' : t.status);
    const disp = t.dispense?.success === true ? '📦ok' : (t.dispense?.success === false ? '📦fail' : '');
    console.log(`  ${t.startedAt?.toISOString().substr(0,16)} txno:${t.txno} ${hint.p_name||'?'} $${hint.price||'?'} ${paid} ${disp}`);
  }

  await client.close();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
