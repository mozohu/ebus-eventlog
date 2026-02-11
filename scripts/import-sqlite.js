#!/usr/bin/env node
/**
 * Import ebus SQLite logs into MongoDB
 * Usage: node import-sqlite.js <sqlite-file> <device-id> [mongodb-uri]
 */

import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';

const sqliteFile = process.argv[2];
const deviceId = process.argv[3];
const mongoUri = process.argv[4] || 'mongodb://admin:ebus2026@localhost:27017/ebus?authSource=admin';

if (!sqliteFile || !deviceId) {
  console.error('Usage: node import-sqlite.js <sqlite-file> <device-id> [mongodb-uri]');
  process.exit(1);
}

async function main() {
  console.log(`📂 Opening SQLite: ${sqliteFile}`);
  const sqlite = new Database(sqliteFile, { readonly: true });

  console.log(`🔗 Connecting to MongoDB...`);
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const db = mongo.db('ebus');

  // Import triggers
  const triggers = sqlite.prepare('SELECT * FROM ebus_trigger').all();
  console.log(`📥 Importing ${triggers.length} triggers...`);
  
  if (triggers.length > 0) {
    const triggerDocs = triggers.map(row => ({
      timestamp: row.timestamp,
      e: row.e,
      arg: row.arg ? JSON.parse(row.arg) : {},
      s: row.s,
      can: row.can,
      sm: row.sm,
      trigger: row.trigger,
      st: row.st,
      deviceId: deviceId
    }));
    await db.collection('triggers').insertMany(triggerDocs);
  }

  // Import transitions
  const transitions = sqlite.prepare('SELECT * FROM ebus_transition').all();
  console.log(`📥 Importing ${transitions.length} transitions...`);
  
  if (transitions.length > 0) {
    const transitionDocs = transitions.map(row => ({
      timestamp: row.timestamp,
      e: row.e,
      arg: row.arg ? JSON.parse(row.arg) : {},
      sm: row.sm,
      transition: row.transition,
      fst: row.fst,
      tst: row.tst,
      deviceId: deviceId
    }));
    await db.collection('transitions').insertMany(transitionDocs);
  }

  sqlite.close();
  await mongo.close();

  console.log(`✅ Import complete!`);
  console.log(`   Triggers: ${triggers.length}`);
  console.log(`   Transitions: ${transitions.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
