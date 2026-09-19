const request = require('supertest');
const app = require('./service');
const { Role, DB } = require('./database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function randomEmail() {
  return randomName() + '@test.com';
}

// Created straight through DB because the API has no way to make an admin.
async function createAdminUser() {
  const user = {
    name: 'pizza admin',
    email: randomEmail(),
    password: 'toomanysecrets',
    roles: [{ role: Role.Admin }],
  };
  await DB.addUser(user);
  return user;
}

// Resolves to { user, token, password } so tests can log the diner back in.
async function registerDiner() {
  const diner = { name: 'pizza diner', email: randomEmail(), password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(diner);
  expect(registerRes.status).toBe(200);
  return { ...registerRes.body, password: diner.password };
}

function login(credentials) {
  return request(app).put('/api/auth').send(credentials);
}

async function loginUser(user) {
  const loginRes = await login({ email: user.email, password: user.password });
  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
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

module.exports = {
  randomName,
  randomEmail,
  createAdminUser,
  registerDiner,
  login,
  loginUser,
  expectResponse,
  expectValidJwt,
};
