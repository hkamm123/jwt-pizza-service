const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database.js');
const { randomName, createAdminUser, registerDiner, login, loginUser, expectResponse } = require('../testUtils.js');

let adminUser;
let adminAuthToken;

beforeAll(async () => {
  adminUser = await createAdminUser();
  adminAuthToken = await loginUser(adminUser);
});

test('list franchises', async () => {
  const { franchise, store } = await createFranchiseWithStore();

  const listRes = await listFranchises({ name: franchise.name });
  expectResponse(listRes, 200, {
    franchises: [
      {
        id: franchise.id,
        name: franchise.name,
        stores: [{ id: store.id, name: store.name }],
      },
    ],
    more: false,
  });
});

test('list franchises shows admins and revenue to an admin', async () => {
  const { franchisee, franchise, store } = await createFranchiseWithStore();

  const listRes = await listFranchises({ name: franchise.name }, adminAuthToken);
  expectResponse(listRes, 200, {
    franchises: [
      {
        id: franchise.id,
        name: franchise.name,
        admins: [{ id: franchisee.id, name: franchisee.name, email: franchisee.email }],
        stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
      },
    ],
    more: false,
  });
});

test('list franchises pages through results', async () => {
  const prefix = randomName();
  const first = await createFranchise(adminAuthToken, { name: `${prefix} one`, admins: [] });
  const second = await createFranchise(adminAuthToken, { name: `${prefix} two`, admins: [] });

  const firstPage = await listFranchises({ name: `${prefix}*`, page: 0, limit: 1 });
  expect(firstPage.status).toBe(200);
  expect(firstPage.body.franchises).toHaveLength(1);
  expect(firstPage.body.more).toBe(true);

  const secondPage = await listFranchises({ name: `${prefix}*`, page: 1, limit: 1 });
  expect(secondPage.status).toBe(200);
  expect(secondPage.body.franchises).toHaveLength(1);
  expect(secondPage.body.more).toBe(false);

  const pagedIds = [...firstPage.body.franchises, ...secondPage.body.franchises].map((f) => f.id);
  expect(pagedIds.sort()).toEqual([first.body.id, second.body.id].sort());
});

test('list franchises responds 400 when limit is not a number', async () => {
  const listRes = await listFranchises({ limit: 'abc' });
  expect(listRes.status).toBe(400);
});

test('list franchises responds 400 when page is negative', async () => {
  const listRes = await listFranchises({ page: -1, limit: 2 });
  expect(listRes.status).toBe(400);
});

test('list user franchises', async () => {
  const { franchisee, franchiseeToken, franchise, store } = await createFranchiseWithStore();

  const expectedFranchises = [
    {
      id: franchise.id,
      name: franchise.name,
      admins: [{ id: franchisee.id, name: franchisee.name, email: franchisee.email }],
      stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
    },
  ];

  const ownRes = await getUserFranchises(franchiseeToken, franchisee.id);
  expectResponse(ownRes, 200, expectedFranchises);

  const adminRes = await getUserFranchises(adminAuthToken, franchisee.id);
  expectResponse(adminRes, 200, expectedFranchises);
});

test('list user franchises is empty for a user with no franchises', async () => {
  const { user, token } = await registerDiner();

  const listRes = await getUserFranchises(token, user.id);
  expectResponse(listRes, 200, []);
});

test('list user franchises responds 403 for another user', async () => {
  const { franchisee } = await createFranchiseWithStore();
  const { token } = await registerDiner();

  const listRes = await getUserFranchises(token, franchisee.id);
  expect(listRes.status).toBe(403);
});

test('list user franchises responds 401 when auth header missing', async () => {
  const listRes = await request(app).get('/api/franchise/1');
  expectResponse(listRes, 401, { message: 'unauthorized' });
});

test('create franchise', async () => {
  const { user, password } = await registerDiner();
  const franchise = { name: 'franchise ' + randomName(), admins: [{ email: user.email }] };

  const createRes = await createFranchise(adminAuthToken, franchise);
  expectResponse(createRes, 200, {
    id: expect.any(Number),
    name: franchise.name,
    admins: [{ id: user.id, name: user.name, email: user.email }],
  });

  const loginRes = await login({ email: user.email, password });
  expect(loginRes.body.user.roles).toContainEqual({ role: 'franchisee', objectId: createRes.body.id });
});

test('create franchise responds 403 when not admin', async () => {
  const { user, token } = await registerDiner();
  const franchise = { name: 'sneaky ' + randomName(), admins: [{ email: user.email }] };

  const createRes = await createFranchise(token, franchise);
  expectResponse(createRes, 403, { message: 'unable to create a franchise' });
  await expectNoFranchiseNamed(franchise.name);
});

test('create franchise responds 404 and saves nothing when admin email is unknown', async () => {
  const franchise = { name: 'orphan ' + randomName(), admins: [{ email: randomName() + '@nobody.com' }] };

  const createRes = await createFranchise(adminAuthToken, franchise);
  expect(createRes.status).toBe(404);
  await expectNoFranchiseNamed(franchise.name);
});

test('create franchise responds 409 when name already taken', async () => {
  const { franchise } = await createFranchiseWithStore();

  const createRes = await createFranchise(adminAuthToken, { name: franchise.name, admins: [] });
  expect(createRes.status).toBe(409);
});

test('create franchise responds 400 when name missing', async () => {
  const createRes = await createFranchise(adminAuthToken, { admins: [] });
  expect(createRes.status).toBe(400);
});

test('create franchise responds 400 when admins missing', async () => {
  const name = 'no admins ' + randomName();

  const createRes = await createFranchise(adminAuthToken, { name });
  expect(createRes.status).toBe(400);
  await expectNoFranchiseNamed(name);
});

test('create franchise responds 401 when auth header missing', async () => {
  const createRes = await request(app).post('/api/franchise').send({ name: 'anonymous', admins: [] });
  expectResponse(createRes, 401, { message: 'unauthorized' });
});

test('delete franchise', async () => {
  const { franchisee, franchiseeToken, franchise } = await createFranchiseWithStore();

  const deleteRes = await deleteFranchise(adminAuthToken, franchise.id);
  expectResponse(deleteRes, 200, { message: 'franchise deleted' });

  await expectNoFranchiseNamed(franchise.name);
  const userFranchisesRes = await getUserFranchises(franchiseeToken, franchisee.id);
  expect(userFranchisesRes.body).toEqual([]);
});

test('delete franchise responds 401 and deletes nothing when auth header missing', async () => {
  const { franchise } = await createFranchiseWithStore();

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`);
  expectResponse(deleteRes, 401, { message: 'unauthorized' });
  await expectFranchiseNamed(franchise.name);
});

test('delete franchise responds 403 and deletes nothing when not admin', async () => {
  const { franchise } = await createFranchiseWithStore();
  const { token } = await registerDiner();

  const deleteRes = await deleteFranchise(token, franchise.id);
  expect(deleteRes.status).toBe(403);
  await expectFranchiseNamed(franchise.name);
});

test('delete franchise responds 404 when franchise does not exist', async () => {
  const deleteRes = await deleteFranchise(adminAuthToken, 999999999);
  expect(deleteRes.status).toBe(404);
});

test('create store as admin', async () => {
  const { franchise } = await createFranchiseWithStore();
  const storeName = 'store ' + randomName();

  const createRes = await createStore(adminAuthToken, franchise.id, { name: storeName });
  expectResponse(createRes, 200, { id: expect.any(Number), franchiseId: franchise.id, name: storeName });

  const listRes = await listFranchises({ name: franchise.name });
  expect(listRes.body.franchises[0].stores).toContainEqual({ id: createRes.body.id, name: storeName });
});

test('create store as franchisee', async () => {
  const { franchiseeToken, franchise } = await createFranchiseWithStore();
  const storeName = 'store ' + randomName();

  const createRes = await createStore(franchiseeToken, franchise.id, { name: storeName });
  expectResponse(createRes, 200, { id: expect.any(Number), franchiseId: franchise.id, name: storeName });
});

test('create store responds 403 when not a franchise admin', async () => {
  const { franchise } = await createFranchiseWithStore();
  const { token } = await registerDiner();

  const createRes = await createStore(token, franchise.id, { name: 'sneaky store' });
  expectResponse(createRes, 403, { message: 'unable to create a store' });
});

test('create store responds 404 when franchise does not exist', async () => {
  const createRes = await createStore(adminAuthToken, 999999999, { name: 'nowhere' });
  expect(createRes.status).toBe(404);
});

test('create store responds 400 when name missing', async () => {
  const { franchise } = await createFranchiseWithStore();

  const createRes = await createStore(adminAuthToken, franchise.id, {});
  expect(createRes.status).toBe(400);
});

test('delete store', async () => {
  const { franchiseeToken, franchise, store } = await createFranchiseWithStore();

  const deleteRes = await deleteStore(franchiseeToken, franchise.id, store.id);
  expectResponse(deleteRes, 200, { message: 'store deleted' });

  const listRes = await listFranchises({ name: franchise.name });
  expect(listRes.body.franchises[0].stores).toEqual([]);
});

test('delete store responds 403 and deletes nothing when not a franchise admin', async () => {
  const { franchise, store } = await createFranchiseWithStore();
  const { token } = await registerDiner();

  const deleteRes = await deleteStore(token, franchise.id, store.id);
  expectResponse(deleteRes, 403, { message: 'unable to delete a store' });

  const listRes = await listFranchises({ name: franchise.name });
  expect(listRes.body.franchises[0].stores).toEqual([{ id: store.id, name: store.name }]);
});

test('delete store responds 404 when store does not exist', async () => {
  const { franchise } = await createFranchiseWithStore();

  const deleteRes = await deleteStore(adminAuthToken, franchise.id, 999999999);
  expect(deleteRes.status).toBe(404);
});

test('delete store responds 404 and deletes nothing when store belongs to another franchise', async () => {
  const mine = await createFranchiseWithStore();
  const theirs = await createFranchiseWithStore();

  const deleteRes = await deleteStore(mine.franchiseeToken, mine.franchise.id, theirs.store.id);
  expect(deleteRes.status).toBe(404);

  const listRes = await listFranchises({ name: theirs.franchise.name });
  expect(listRes.body.franchises[0].stores).toEqual([{ id: theirs.store.id, name: theirs.store.name }]);
});

// Builds a franchise owned by a fresh franchisee, with one store in it.
async function createFranchiseWithStore() {
  const { user: franchisee, token: franchiseeToken } = await registerDiner();
  const franchise = await DB.createFranchise({
    name: 'franchise ' + randomName(),
    admins: [{ email: franchisee.email }],
  });
  const store = await DB.createStore(franchise.id, { name: 'store ' + randomName() });
  return { franchisee, franchiseeToken, franchise, store };
}

function listFranchises(query, token) {
  const req = request(app).get('/api/franchise').query(query);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

function getUserFranchises(token, userId) {
  return request(app)
    .get(`/api/franchise/${userId}`)
    .set('Authorization', `Bearer ${token}`);
}

function createFranchise(token, franchise) {
  return request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send(franchise);
}

function deleteFranchise(token, franchiseId) {
  return request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${token}`);
}

function createStore(token, franchiseId, store) {
  return request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${token}`)
    .send(store);
}

function deleteStore(token, franchiseId, storeId) {
  return request(app)
    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
    .set('Authorization', `Bearer ${token}`);
}

async function expectFranchiseNamed(name) {
  const listRes = await listFranchises({ name });
  expect(listRes.body.franchises).toHaveLength(1);
}

async function expectNoFranchiseNamed(name) {
  const listRes = await listFranchises({ name });
  expect(listRes.body.franchises).toEqual([]);
}
