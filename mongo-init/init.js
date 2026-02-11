// Initialize ebus database and collections
db = db.getSiblingDB('ebus');

// Create collections without strict validation (Mongoose handles it)
db.createCollection('triggers');
db.createCollection('transitions');

// Create indexes for common queries
db.triggers.createIndex({ timestamp: -1 });
db.triggers.createIndex({ sm: 1, trigger: 1 });
db.triggers.createIndex({ deviceId: 1, timestamp: -1 });
db.triggers.createIndex({ e: 1 });

db.transitions.createIndex({ timestamp: -1 });
db.transitions.createIndex({ sm: 1, transition: 1 });
db.transitions.createIndex({ deviceId: 1, timestamp: -1 });
db.transitions.createIndex({ fst: 1, tst: 1 });

print('✅ ebus database initialized with triggers and transitions collections');
