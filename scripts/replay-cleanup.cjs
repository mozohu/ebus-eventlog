#!/usr/bin/env node
/**
 * Clean up a replay batch from MongoDB.
 * Usage: node replay-cleanup.cjs <replayBatch>
 */
const { MongoClient } = require('mongodb');
const BATCH = process.argv[2];
if (!BATCH) { console.error('Usage: node replay-cleanup.cjs <replayBatch>'); process.exit(1); }
async function main() {
  const client = new MongoClient('mongodb://admin:ebus2026@localhost:27017/ebus?authSource=admin');
  await client.connect();
  const db = client.db('ebus');
  for (const col of ['sessions','orders','transactions','daily_stats','triggers']) {
    const r = await db.collection(col).deleteMany({ replayBatch: BATCH });
    console.log(`${col}: deleted ${r.deletedCount}`);
  }
  await client.close();
  console.log('Done!');
}
main().catch(e => { console.error(e); process.exit(1); });
