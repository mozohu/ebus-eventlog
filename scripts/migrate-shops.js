/**
 * Migration script: 建立 shops 和 devices collections
 * 用於將寫死的 STORE_DEVICES 移至 MongoDB
 * 
 * Usage: node migrate-shops.js [mongodb-uri]
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.argv[2] || process.env.MONGODB_URI || 'mongodb://localhost:27017/ebus';

// 原本寫死的資料
const INITIAL_SHOPS = [
  {
    id: 'vm01',
    name: 'vm01店',
    storerDeviceId: '0242ac1c0002',
    retrieverDeviceId: '0242ac1e0008'
  },
  {
    id: 'vm02',
    name: 'vm02店',
    storerDeviceId: '0242ac220002',
    retrieverDeviceId: '0242ac230008'
  }
];

// Shop schema
const shopSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  storerDeviceId: { type: String, required: true },
  retrieverDeviceId: { type: String, required: true }
}, { collection: 'shops' });

// Device schema
const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }
}, { collection: 'devices' });

const Shop = mongoose.model('Shop', shopSchema);
const Device = mongoose.model('Device', deviceSchema);

async function migrate() {
  console.log(`Connecting to ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // 建立 shops
  console.log('\n📦 Migrating shops...');
  for (const shop of INITIAL_SHOPS) {
    try {
      await Shop.findOneAndUpdate(
        { id: shop.id },
        shop,
        { upsert: true, new: true }
      );
      console.log(`  ✅ ${shop.id}: ${shop.name}`);
    } catch (err) {
      console.log(`  ⚠️ ${shop.id}: ${err.message}`);
    }
  }

  // 建立 devices
  console.log('\n📱 Migrating devices...');
  const deviceIds = new Set();
  for (const shop of INITIAL_SHOPS) {
    deviceIds.add(shop.storerDeviceId);
    deviceIds.add(shop.retrieverDeviceId);
  }

  for (const deviceId of deviceIds) {
    try {
      await Device.findOneAndUpdate(
        { id: deviceId },
        { id: deviceId },
        { upsert: true, new: true }
      );
      console.log(`  ✅ ${deviceId}`);
    } catch (err) {
      console.log(`  ⚠️ ${deviceId}: ${err.message}`);
    }
  }

  // 建立 indexes
  console.log('\n🔧 Creating indexes...');
  await Shop.collection.createIndex({ id: 1 }, { unique: true });
  await Device.collection.createIndex({ id: 1 }, { unique: true });
  console.log('  ✅ Indexes created');

  // 顯示結果
  const shopCount = await Shop.countDocuments();
  const deviceCount = await Device.countDocuments();
  console.log(`\n✅ Migration complete: ${shopCount} shops, ${deviceCount} devices`);

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
