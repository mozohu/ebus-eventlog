const Database = require('better-sqlite3');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const DEVICE_ID = process.argv[2];
const SQLITE_DIR = process.argv[3];
const REPLAY_BATCH = process.argv[4] || 'v1';

async function main() {
  const files = fs.readdirSync(SQLITE_DIR).filter(f => f.endsWith('.sqlite')).sort();
  const client = new MongoClient('mongodb://admin:ebus2026@localhost:27017/ebus?authSource=admin');
  await client.connect();
  const db = client.db('ebus');

  // Get session ranges
  const sessions = await db.collection('sessions')
    .find({ replayBatch: REPLAY_BATCH, deviceId: DEVICE_ID })
    .sort({ startedAt: 1 }).project({ startedAt: 1, endedAt: 1 }).toArray();
  console.log(`Sessions: ${sessions.length}`);

  let totalInserted = 0;
  for (const f of files) {
    const sqlDb = new Database(path.join(SQLITE_DIR, f), { readonly: true });
    const rows = sqlDb.prepare("SELECT timestamp, e, arg, s, can, sm, trigger AS trig, st FROM ebus_trigger ORDER BY timestamp").all();
    sqlDb.close();

    const batch = [];
    for (const row of rows) {
      let arg = {};
      try { arg = JSON.parse(row.arg || '{}'); } catch {}
      const tsMs = row.timestamp > 1e15 ? row.timestamp / 1000 : row.timestamp > 1e12 ? row.timestamp : row.timestamp * 1000;
      const receivedAt = new Date(tsMs);

      // Check if within any session window
      let inSession = false;
      for (const sess of sessions) {
        if (receivedAt >= sess.startedAt && (!sess.endedAt || receivedAt <= sess.endedAt)) {
          inSession = true;
          break;
        }
      }
      if (!inSession) continue;

      batch.push({
        deviceId: DEVICE_ID, timestamp: row.timestamp, type: 'trigger',
        e: row.e, arg, s: row.s, can: row.can,
        sm: row.sm || (row.e || '').split('/')[0],
        trigger: row.trig || (row.e || '').split('/')[1],
        st: row.st, receivedAt,
        replayBatch: REPLAY_BATCH, source: 'replay'
      });
    }

    if (batch.length > 0) {
      await db.collection('triggers').insertMany(batch);
      totalInserted += batch.length;
      process.stdout.write(`\r${f}: +${batch.length} (total: ${totalInserted})`);
    }
  }
  console.log(`\nDone! Total inserted: ${totalInserted}`);
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
