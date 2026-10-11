const request = require('supertest');
const app = require('../src/service');
const { DB } = require('../src/database/database.js');
const {
  randomName,
  randomEmail,
  createAdminUser,
  registerDiner,
  login,
  loginUser,
  expectResponse,
  expectValidJwt,
} = require('../src/testUtils.js');

let adminUser;
let adminAuthToken;

beforeAll(async () => {
  adminUser = await createAdminUser();
  adminAuthToken = await loginUser(adminUser);
});

test('get me', async () => {
  const { user, token } = await registerDiner();

  const meRes = await getMe(token);
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({
    id: user.id,
    name: user.name,
    email: user.email,
    roles: [{ role: 'diner' }],
  });
  expect(meRes.body).not.toHaveProperty('password');
});

test('get me responds 401 when bad token', async () => {
  const meRes = await getMe('not.a.realtoken');
  expectResponse(meRes, 401, { message: 'unauthorized' });
});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
  expect(listUsersRes.body).not.toHaveProperty('users');
});

test('list users', async () => {
  const listUsersRes = await listUsers(adminAuthToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users).toEqual(expect.any(Array));
  expect(listUsersRes.body.users.length).toBeGreaterThan(0);
});

test('list users never returns passwords', async () => {
  const listUsersRes = await listUsers(adminAuthToken);
  expect(listUsersRes.status).toBe(200);
  for (const user of listUsersRes.body.users) {
    expect(user).not.toHaveProperty('password');
  }
});

test('list users attaches each user their own roles', async () => {
  const prefix = randomName();
  const { user: franchisee } = await registerDiner(`${prefix} franchisee`);
  const { user: diner } = await registerDiner(`${prefix} diner`);
  const franchise = await DB.createFranchise({
    name: 'franchise ' + randomName(),
    admins: [{ email: franchisee.email }],
  });

  const listUsersRes = await listUsers(adminAuthToken, { name: `${prefix}*` });
  expect(listUsersRes.status).toBe(200);
  const [listedFranchisee, listedDiner] = listUsersRes.body.users;

  expect(listedFranchisee.id).toBe(franchisee.id);
  expect(listedFranchisee.roles).toHaveLength(2);
  expect(listedFranchisee.roles).toEqual(
    expect.arrayContaining([
      { role: 'diner' },
      { role: 'franchisee', objectId: franchise.id },
    ]),
  );

  expect(listedDiner.id).toBe(diner.id);
  expect(listedDiner.roles).toEqual([{ role: 'diner' }]);
});

test('list users allows the maximum limit', async () => {
  const listUsersRes = await listUsers(adminAuthToken, { limit: 100 });
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.length).toBeLessThanOrEqual(100);
});

test('list users pages through results', async () => {
  // Two users guarantee at least two pages when the limit is 1.
  await registerDiner();
  await registerDiner();

  const firstPage = await listUsers(adminAuthToken, { page: 0, limit: 1 });
  expect(firstPage.status).toBe(200);
  expect(firstPage.body.users).toHaveLength(1);
  expect(firstPage.body.more).toBe(true);

  const secondPage = await listUsers(adminAuthToken, { page: 1, limit: 1 });
  expect(secondPage.status).toBe(200);
  expect(secondPage.body.users).toHaveLength(1);
  expect(secondPage.body.users[0].id).not.toBe(firstPage.body.users[0].id);
});

test('list users filters by exact name', async () => {
  const name = 'diner ' + randomName();
  const { user } = await registerDiner(name);

  const listUsersRes = await listUsers(adminAuthToken, { name });
  expectResponse(listUsersRes, 200, {
    users: [{ id: user.id, name, email: user.email, roles: [{ role: 'diner' }] }],
    more: false,
  });
});

test('list users filters by name with a wildcard', async () => {
  const prefix = randomName();
  const { user: first } = await registerDiner(`${prefix} one`);
  const { user: second } = await registerDiner(`${prefix} two`);
  await registerDiner(`not ${prefix}`);

  const listUsersRes = await listUsers(adminAuthToken, { name: `${prefix}*` });
  expect(listUsersRes.status).toBe(200);
  const ids = listUsersRes.body.users.map((u) => u.id);
  expect(ids.sort()).toEqual([first.id, second.id].sort());
});

test('list users pages through filtered results', async () => {
  const prefix = randomName();
  await registerDiner(`${prefix} one`);
  await registerDiner(`${prefix} two`);

  const firstPage = await listUsers(adminAuthToken, { name: `${prefix}*`, page: 0, limit: 1 });
  expect(firstPage.body.users).toHaveLength(1);
  expect(firstPage.body.more).toBe(true);

  const lastPage = await listUsers(adminAuthToken, { name: `${prefix}*`, page: 1, limit: 1 });
  expect(lastPage.body.users).toHaveLength(1);
  expect(lastPage.body.more).toBe(false);
});

test('list users returns an empty list when no names match', async () => {
  const listUsersRes = await listUsers(adminAuthToken, { name: 'nobody ' + randomName() });
  expectResponse(listUsersRes, 200, { users: [], more: false });
});

test.each([
  { page: 'abc' },
  { page: -1 },
  { page: 1.5 },
  { limit: 'abc' },
  { limit: -1 },
  { limit: 1.5 },
  { limit: 0 },
  { limit: 101 },
  'name=a&name=b',
])('list users responds 400 when query is %o', async (query) => {
  const listUsersRes = await listUsers(adminAuthToken, query);
  expectResponse(listUsersRes, 400, { message: 'bad request' });
});

test('list users responds 403 when not an admin', async () => {
  const { token } = await registerDiner();
  const listUsersRes = await listUsers(token);
  expect(listUsersRes.status).toBe(403);
  expect(listUsersRes.body).not.toHaveProperty('users');
});

test('update user', async () => {
  const { user, token } = await registerDiner();
  const changes = {
    name: 'updated diner',
    email: randomEmail(),
    password: 'newPassword',
  };

  const updateRes = await updateUser(token, user.id, changes);
  expect(updateRes.status).toBe(200);
  const expectedUser = {
    id: user.id,
    name: changes.name,
    email: changes.email,
    roles: [{ role: 'diner' }],
  };
  expect(updateRes.body.user).toEqual(expectedUser);
  expectValidJwt(updateRes.body.token);

  const meRes = await getMe(updateRes.body.token);
  expect(meRes.body).toMatchObject(expectedUser);

  const loginRes = await login({
    email: changes.email,
    password: changes.password,
  });
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.user).toEqual(expectedUser);
});

test('update user name only', async () => {
  const { user, token } = await registerDiner();

  const updateRes = await updateUser(token, user.id, { name: 'renamed diner' });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toEqual({
    id: user.id,
    name: 'renamed diner',
    email: user.email,
    roles: [{ role: 'diner' }],
  });
});

test('update user password only', async () => {
  const { user, token } = await registerDiner();

  const updateRes = await updateUser(token, user.id, {
    password: 'newPassword',
  });
  expect(updateRes.status).toBe(200);

  const loginRes = await login({ email: user.email, password: 'newPassword' });
  expect(loginRes.status).toBe(200);
});

test('update user saves names containing an apostrophe', async () => {
  const { user, token } = await registerDiner();

  const updateRes = await updateUser(token, user.id, {
    name: "d'Artagnan",
    email: user.email,
  });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user.name).toBe("d'Artagnan");
});

test('admin can update another user', async () => {
  const { user } = await registerDiner();
  const changes = { name: 'admin renamed', email: randomEmail() };

  const updateRes = await updateUser(adminAuthToken, user.id, changes);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toEqual({
    id: user.id,
    ...changes,
    roles: [{ role: 'diner' }],
  });
});

test('update user responds 403 when updating someone else', async () => {
  const { token } = await registerDiner();
  const victim = await registerDiner();

  const updateRes = await updateUser(token, victim.user.id, {
    name: 'hacked',
    email: randomEmail(),
    password: 'hacked',
  });
  expectResponse(updateRes, 403, { message: 'unauthorized' });

  const loginRes = await login({
    email: victim.user.email,
    password: victim.password,
  });
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.user.name).toBe(victim.user.name);
});

test('update user responds 409 when email belongs to another user', async () => {
  const { user, token } = await registerDiner();

  const updateRes = await updateUser(token, user.id, {
    email: adminUser.email,
  });
  expect(updateRes.status).toBe(409);
  expect(updateRes.body).not.toHaveProperty('token');
});

test('update user responds 404 when admin updates a user that does not exist', async () => {
  const updateRes = await updateUser(adminAuthToken, 999999999, {
    name: 'nobody',
    email: randomEmail(),
  });
  expect(updateRes.status).toBe(404);
});

test('update user responds 401 when auth header missing', async () => {
  const updateRes = await request(app)
    .put('/api/user/1')
    .send({ name: 'anonymous' });
  expectResponse(updateRes, 401, { message: 'unauthorized' });
});

function getMe(token) {
  return request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);
}

function listUsers(token, query = {}) {
  return request(app)
    .get('/api/user')
    .query(query)
    .set('Authorization', `Bearer ${token}`);
}

function updateUser(token, userId, changes) {
  return request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(changes);
}
