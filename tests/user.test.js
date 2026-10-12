const request = require('supertest');
const app = require('../src/service');
const {
  createAdminUser,
  registerDiner,
  login,
  loginUser,
  expectResponse,
} = require('../src/testUtils.js');

let adminAuthToken;

beforeAll(async () => {
  adminAuthToken = await loginUser(await createAdminUser());
});

test('delete user', async () => {
  const { user, password } = await registerDiner();

  const deleteRes = await deleteUser(adminAuthToken, user.id);
  expectResponse(deleteRes, 200, { message: 'User deleted successfully' });

  const loginRes = await login({ email: user.email, password });
  expect(loginRes.status).toBe(401);
});

test('delete user invalidates the deleted user\'s existing token', async () => {
  const { user, token } = await registerDiner();

  await deleteUser(adminAuthToken, user.id);

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);
  expectResponse(meRes, 401, { message: 'unauthorized' });
});

test('delete user responds 401 without a token', async () => {
  const { user, password } = await registerDiner();

  const deleteRes = await request(app).delete(`/api/user/${user.id}`);
  expectResponse(deleteRes, 401, { message: 'unauthorized' });

  const loginRes = await login({ email: user.email, password });
  expect(loginRes.status).toBe(200);
});

test('delete user responds 403 when not admin', async () => {
  const diner = await registerDiner();
  const otherDiner = await registerDiner();

  for (const target of [diner, otherDiner]) {
    const deleteRes = await deleteUser(diner.token, target.user.id);
    expectResponse(deleteRes, 403, { message: 'unauthorized' });

    const loginRes = await login({ email: target.user.email, password: target.password });
    expect(loginRes.status).toBe(200);
  }
});

test('delete user responds 403 when admin deletes themselves', async () => {
  const admin = await createAdminUser();
  const loginRes = await login({ email: admin.email, password: admin.password });
  const { user, token } = loginRes.body;

  const deleteRes = await deleteUser(token, user.id);
  expectResponse(deleteRes, 403, { message: 'cannot delete yourself' });

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);
  expect(meRes.status).toBe(200);
});

test('delete user responds 404 when user does not exist', async () => {
  const { user } = await registerDiner();
  await deleteUser(adminAuthToken, user.id);

  const deleteRes = await deleteUser(adminAuthToken, user.id);
  expectResponse(deleteRes, 404, { message: 'unknown user' });
});

test('delete user responds 400 when userId is not a positive integer', async () => {
  for (const userId of ['abc', '1.5', '-1', '1e3', '0x10']) {
    const deleteRes = await deleteUser(adminAuthToken, userId);
    expectResponse(deleteRes, 400, { message: 'bad request' });
  }
});

function deleteUser(token, userId) {
  return request(app)
    .delete(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${token}`);
}
