#!/usr/bin/env node
/**
 * ebus-eventlog GraphQL API schema 驗證測試
 * 用法：node test/schema-test.js [API_URL]
 * 預設 API_URL: http://127.0.0.1:4000/
 *
 * 測試項目：
 * 1. Schema introspection（確認 server 啟動正常）
 * 2. 各 module 的 Query 可查詢
 * 3. Users CRUD
 * 4. Operators CRUD
 * 5. Hids CRUD
 */

const API = process.argv[2] || 'http://127.0.0.1:4000/';

let passed = 0;
let failed = 0;
const errors = [];

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    errors.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ============================================================
console.log(`\n🧪 ebus-eventlog GraphQL API tests (${API})\n`);

// --- Schema ---
console.log('Schema:');
await test('introspection', async () => {
  const data = await gql(`{ __schema { queryType { name } mutationType { name } } }`);
  assert(data.__schema.queryType.name === 'Query');
  assert(data.__schema.mutationType.name === 'Mutation');
});

// --- Common queries ---
console.log('\nCommon:');
await test('triggerCount', async () => {
  const data = await gql(`{ triggerCount }`);
  assert(typeof data.triggerCount === 'number');
});

await test('stateMachines', async () => {
  const data = await gql(`{ stateMachines }`);
  assert(Array.isArray(data.stateMachines));
});

// --- Vend queries ---
console.log('\nVend:');
await test('vendSessions', async () => {
  const data = await gql(`{ vendSessions(limit: 1) { sid } }`);
  assert(Array.isArray(data.vendSessions));
});

await test('vendTransactionSummaries', async () => {
  const data = await gql(`{ vendTransactionSummaries(limit: 1) { txno } }`);
  assert(Array.isArray(data.vendTransactionSummaries));
});

// --- Users CRUD ---
console.log('\nUsers:');
const testLineUserId = `TEST_${Date.now()}`;

await test('userCount', async () => {
  const data = await gql(`{ userCount }`);
  assert(typeof data.userCount === 'number');
});

await test('upsertUser', async () => {
  const data = await gql(`mutation($input: UpsertUserInput!) {
    upsertUser(input: $input) { lineUserId displayName roles }
  }`, { input: { lineUserId: testLineUserId, displayName: 'Test User', pictureUrl: '' } });
  assert(data.upsertUser.lineUserId === testLineUserId);
  assert(data.upsertUser.roles.length === 0);
});

await test('user query', async () => {
  const data = await gql(`query($id: String!) { user(lineUserId: $id) { lineUserId displayName } }`,
    { id: testLineUserId });
  assert(data.user.displayName === 'Test User');
});

await test('updateUserRoles', async () => {
  const data = await gql(`mutation($input: UpdateUserRolesInput!) {
    updateUserRoles(input: $input) { roles }
  }`, { input: { lineUserId: testLineUserId, roles: ['admin', 'operator'] } });
  assert(data.updateUserRoles.roles.includes('admin'));
  assert(data.updateUserRoles.roles.includes('operator'));
});

// cleanup: 不刪 user（沒有 deleteUser mutation），留著無妨

// --- Operators CRUD ---
console.log('\nOperators:');
const testOpCode = `TEST_OP_${Date.now()}`;
let testOpId = '';

await test('operatorCount', async () => {
  const data = await gql(`{ operatorCount }`);
  assert(typeof data.operatorCount === 'number');
});

await test('createOperator', async () => {
  const data = await gql(`mutation($input: CreateOperatorInput!) {
    createOperator(input: $input) { id code name status }
  }`, { input: { code: testOpCode, name: 'Test Operator', status: 'active' } });
  assert(data.createOperator.code === testOpCode);
  testOpId = data.createOperator.id;
});

await test('operators query', async () => {
  const data = await gql(`{ operators { id code name } }`);
  assert(data.operators.some(o => o.code === testOpCode));
});

await test('updateOperator', async () => {
  const data = await gql(`mutation($id: ID!, $input: UpdateOperatorInput!) {
    updateOperator(id: $id, input: $input) { name }
  }`, { id: testOpId, input: { name: 'Updated Operator' } });
  assert(data.updateOperator.name === 'Updated Operator');
});

await test('deleteOperator', async () => {
  const data = await gql(`mutation($id: ID!) { deleteOperator(id: $id) }`, { id: testOpId });
  assert(data.deleteOperator === true);
});

// --- Hids CRUD ---
console.log('\nHids:');
const testHidCode = `TEST_HID_${Date.now()}`;
let testHidId = '';

await test('hidCount', async () => {
  const data = await gql(`{ hidCount }`);
  assert(typeof data.hidCount === 'number');
});

await test('createHid', async () => {
  const data = await gql(`mutation($input: CreateHidInput!) {
    createHid(input: $input) { id code status }
  }`, { input: { code: testHidCode, status: 'active', notes: 'test' } });
  assert(data.createHid.code === testHidCode);
  testHidId = data.createHid.id;
});

await test('hids query', async () => {
  const data = await gql(`{ hids { id code status } }`);
  assert(data.hids.some(h => h.code === testHidCode));
});

await test('updateHid', async () => {
  const data = await gql(`mutation($id: ID!, $input: UpdateHidInput!) {
    updateHid(id: $id, input: $input) { notes }
  }`, { id: testHidId, input: { notes: 'updated' } });
  assert(data.updateHid.notes === 'updated');
});

await test('deleteHid', async () => {
  const data = await gql(`mutation($id: ID!) { deleteHid(id: $id) }`, { id: testHidId });
  assert(data.deleteHid === true);
});

// --- Machines CRUD ---
console.log('\nMachines:');
const testVmid = `TEST_VM_${Date.now()}`;
let testVmId = '';

await test('vmCount', async () => {
  const data = await gql(`{ vmCount }`);
  assert(typeof data.vmCount === 'number');
});

await test('createVm', async () => {
  const data = await gql(`mutation($input: CreateVmInput!) {
    createVm(input: $input) { id vmid hidCode operatorId locationName status }
  }`, { input: { vmid: testVmid, hidCode: 'H001', operatorId: 'zgo', locationName: '測試店', status: 'active' } });
  assert(data.createVm.vmid === testVmid);
  testVmId = data.createVm.id;
});

await test('vms query', async () => {
  const data = await gql(`{ vms { id vmid } }`);
  assert(data.vms.some(m => m.vmid === testVmid));
});

await test('updateVm', async () => {
  const data = await gql(`mutation($id: ID!, $input: UpdateVmInput!) {
    updateVm(id: $id, input: $input) { locationName }
  }`, { id: testVmId, input: { locationName: '更新店' } });
  assert(data.updateVm.locationName === '更新店');
});

await test('deleteVm', async () => {
  const data = await gql(`mutation($id: ID!) { deleteVm(id: $id) }`, { id: testVmId });
  assert(data.deleteVm === true);
});

// ============================================================
console.log(`\n${'─'.repeat(40)}`);
console.log(`✅ ${passed} passed  ❌ ${failed} failed`);
if (errors.length) {
  console.log('\nFailed tests:');
  errors.forEach(e => console.log(`  • ${e.name}: ${e.error}`));
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
