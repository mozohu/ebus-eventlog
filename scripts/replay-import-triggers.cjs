#!/usr/bin/env node
/**
 * Import SQLite triggers into MongoDB triggers collection for sessionTimeline.
 * Only imports triggers within session time ranges of a replay batch.
 * 
 * Usage: node replay-import-triggers.cjs <deviceId> <sqliteDir> <replayBatch>
 */

const Database = require('better-sqlite3');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const DEVICE_ID = process.argv[2];
const SQLITE_DIR = process.argv[3];
const REPLAY_BATCH = process.argv[4] || 'v1';
const MONGO_URI = 'mongodb://admin:ebus2026@localhost:27017/ebus?authSource=admin';

async function main() {
  const files = fs.readdirSync(SQLITE_DIR).filter(f => f.endsWith('.sqlite')).sort();
  console.log(`Importing triggers for ${DEVICE_ID}, batch=${REPLAY_BATCH}, ${files.length} files`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('ebus');

  // Get session time ranges from replay batch
  const sessions = await db.collection('sessions')
    .find({ replayBatch: REPLAY_BATCH, deviceId: DEVICE_ID })
    .sort({ startedAt: 1 })
    .toArray();
  console.log(`Sessions in batch: ${sessions.length}`);

  // Read all triggers from SQLite
  let allTriggers = [];
  for (const f of files) {
    const sqlDb = new Database(path.join(SQLITE_DIR, f), { readonly: true });
    const rows = sqlDb.prepare("SELECT timestamp, e, arg, s, can, sm, trigger AS trig, st FROM ebus_trigger ORDER BY timestamp").all();
    for (const row of rows) {
      let arg = {};
      try { arg = JSON.parse(row.arg || '{}'); } catch {}
      const tsMs = row.timestamp > 1e15 ? row.timestamp / 1000 : row.timestamp > 1e12 ? row.timestamp : row.timestamp * 1000;
      allTriggers.push({
        deviceId: DEVICE_ID,
        timestamp: row.timestamp,
        type: 'trigger',
        e: row.e,
        arg,
        s: row.s,
        can: row.can,
        sm: row.sm || (row.e || '').split('/')[0],
        trigger: row.trig || (row.e || '').split('/')[1],
        st: row.st,
        receivedAt: new Date(tsMs),
        replayBatch: REPLAY_BATCH,
        source: 'replay'
      });
    }
    sqlDb.close();
  }
  allTriggers.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`Total triggers from SQLite: ${allTriggers.length}`);

  // Filter: only triggers within session time windows
  const filtered = [];
  for (const t of allTriggers) {
    for (const sess of sessions) {
      if (t.receivedAt >= sess.startedAt && (!sess.endedAt || t.receivedAt <= sess.endedAt)) {
        filtered.push(t);
        break;
      }
    }
  }
  console.log(`Triggers within session windows: ${filtered.length}`);

  // Insert in bulk
  if (filtered.length > 0) {
    const result = await db.collection('triggers').insertMany(filtered);
    console.log(`Inserted: ${result.insertedCount}`);
  }

  // Verify
  const count = await db.collection('triggers').countDocuments({ replayBatch: REPLAY_BATCH });
  console.log(`Total replay triggers in MongoDB: ${count}`);

  await client.close();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
