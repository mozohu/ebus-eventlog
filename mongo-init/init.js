// Initialize ebus database and collections
db = db.getSiblingDB('ebus');

// Create collections without strict validation (Mongoose handles it)
db.createCollection('triggers');
db.createCollection('transitions');
db.createCollection('shops');
db.createCollection('devices');

// Create indexes for common queries
db.triggers.createIndex({ timestamp: -1 });
db.triggers.createIndex({ sm: 1, trigger: 1 });
db.triggers.createIndex({ deviceId: 1, timestamp: -1 });
db.triggers.createIndex({ e: 1 });
db.triggers.createIndex({ 'arg.oid': 1 });

db.transitions.createIndex({ timestamp: -1 });
db.transitions.createIndex({ sm: 1, transition: 1 });
db.transitions.createIndex({ deviceId: 1, timestamp: -1 });
db.transitions.createIndex({ fst: 1, tst: 1 });

db.shops.createIndex({ id: 1 }, { unique: true });
db.devices.createIndex({ id: 1 }, { unique: true });

// Insert initial shop data
db.shops.insertMany([
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
]);

// Insert initial device data
db.devices.insertMany([
  { id: '0242ac1c0002' },
  { id: '0242ac1e0008' },
  { id: '0242ac220002' },
  { id: '0242ac230008' }
]);

print('✅ ebus database initialized with triggers, transitions, shops, and devices collections');
