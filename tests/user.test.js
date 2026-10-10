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

function deleteUser(token, userId) {
  return request(app)
    .delete(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${token}`);
}
