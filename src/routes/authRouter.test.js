const request = require('supertest');
const app = require('../service');
const { randomEmail, login, expectResponse, expectValidJwt } = require('../testUtils.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = randomEmail();
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('register', async () => {
  const newUser = { name: 'new diner', email: randomEmail(), password: 'b' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);

  const expectedUser = { name: newUser.name, email: newUser.email, roles: [{ role: 'diner' }] };
  expect(registerRes.body.user).toMatchObject(expectedUser);
  expect(registerRes.body.user.id).toEqual(expect.any(Number));
  expect(registerRes.body.user).not.toHaveProperty('password');

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${registerRes.body.token}`);
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject(expectedUser);
});

test('register responds 400 when password missing', async () => {
  const registerRes = await request(app)
    .post('/api/auth')
    .send({ name: 'new diner', email: randomEmail() });
  expectResponse(registerRes, 400, { message: 'name, email, and password are required' });
  expect(registerRes.body).not.toHaveProperty('token');
});

test('login', async () => {
  const loginRes = await login(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login responds 401 when bad password', async () => {
  const loginRes = await login({ ...testUser, password: 'badPassword' });
  expectResponse(loginRes, 401, { message: 'unknown user' });
});

test('login responds 400 when empty password given', async () => {
  const loginRes = await login({ ...testUser, password: '' });
  expectResponse(loginRes, 400, { message: 'bad request' });
});

test('login responds 400 when password missing', async () => {
  const loginRes = await login({ email: testUser.email });
  expectResponse(loginRes, 400, { message: 'bad request' });
});

test('login responds 400 when email missing', async () => {
  const loginRes = await login({ password: testUser.password });
  expectResponse(loginRes, 400, { message: 'bad request' });
});

test('logout successful', async () => {
  const token = await loginTestUser();

  const logoutRes = await logout(token);
  expectResponse(logoutRes, 200, { message: 'logout successful' });

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);
  expectResponse(meRes, 401, { message: 'unauthorized' });
});

test('logout responds 401 when token already logged out', async () => {
  const token = await loginTestUser();

  const firstLogoutRes = await logout(token);
  expectResponse(firstLogoutRes, 200, { message: 'logout successful' });

  const secondLogoutRes = await logout(token);
  expectResponse(secondLogoutRes, 401, { message: 'unauthorized' });
});

test('logout responds 401 when bad token', async () => {
  const logoutRes = await logout('not.a.realtoken');
  expectResponse(logoutRes, 401, { message: 'unauthorized' });
});

test('logout responds 401 when auth header missing', async () => {
  const logoutRes = await request(app).delete('/api/auth');
  expectResponse(logoutRes, 401, { message: 'unauthorized' });
});

async function loginTestUser() {
  const loginRes = await login(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);
  return loginRes.body.token;
}

function logout(token) {
  return request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${token}`);
}
