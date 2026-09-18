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
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login responds 401 when bad password', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ ...testUser, password: 'badPassword' });
  expect(loginRes.status).toBe(401);
  expect(loginRes.body).toEqual({ message: 'unknown user' });
});

test('login responds 400 when empty password given', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ ...testUser, password: '' });
  expect(loginRes.status).toBe(400);
  expect(loginRes.body).toEqual({ message: 'bad request' });
});

test('login responds 400 when password missing', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ email: testUser.email });
  expect(loginRes.status).toBe(400);
  expect(loginRes.body).toEqual({ message: 'bad request' });
});

test('login responds 400 when email missing', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ password: testUser.password });
  expect(loginRes.status).toBe(400);
  expect(loginRes.body).toEqual( { message: 'bad request' });
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}
