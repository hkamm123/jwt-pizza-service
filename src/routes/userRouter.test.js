const request = require('supertest');
const app = require('../service');
const {
  randomEmail,
  createAdminUser,
  registerDiner,
  login,
  loginUser,
  expectResponse,
  expectValidJwt,
} = require('../testUtils.js');

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

  const loginRes = await login({ email: victim.user.email, password: victim.password });
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

function updateUser(token, userId, changes) {
  return request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(changes);
}
