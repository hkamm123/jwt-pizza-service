const request = require('supertest');
const app = require('../service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
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

function login(credentials) {
  return request(app).put('/api/auth').send(credentials);
}

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

function expectResponse(actualRes, expectedStatus, expectedBody) {
  expect(actualRes.status).toBe(expectedStatus);
  expect(actualRes.body).toEqual(expectedBody);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}
