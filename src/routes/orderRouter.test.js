const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

let adminAuthToken;
let menuItem;
let franchise;
let store;

beforeAll(async () => {
  const adminUser = await createAdminUser();
  adminAuthToken = await loginUser(adminUser);

  menuItem = await DB.addMenuItem({
    title: 'Test Pie ' + randomName(),
    description: 'A pizza made for testing',
    image: 'pizza1.png',
    price: 0.0042,
  });
  franchise = await DB.createFranchise({ name: 'franchise ' + randomName(), admins: [{ email: adminUser.email }] });
  store = await DB.createStore(franchise.id, { name: 'store ' + randomName() });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('get menu', async () => {
  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toContainEqual(menuItem);
});

test('get menu is public even with a bad token', async () => {
  const menuRes = await request(app)
    .get('/api/order/menu')
    .set('Authorization', 'Bearer not.a.realtoken');
  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toContainEqual(menuItem);
});

test('add menu item', async () => {
  const newItem = { title: 'Student ' + randomName(), description: 'No topping, no sauce, just carbs', image: 'pizza9.png', price: 0.0001 };
  const addRes = await addMenuItem(adminAuthToken, newItem);
  expect(addRes.status).toBe(200);
  expect(addRes.body).toContainEqual({ ...newItem, id: expect.any(Number) });
});

test('add menu item responds 403 when not admin', async () => {
  const { token } = await registerDiner();
  const newItem = { title: 'Sneaky ' + randomName(), description: 'Should not exist', image: 'pizza9.png', price: 0.0001 };

  const addRes = await addMenuItem(token, newItem);
  expectResponse(addRes, 403, { message: 'unable to add menu item' });

  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.body.map((item) => item.title)).not.toContain(newItem.title);
});

test('get orders', async () => {
  const { user, token } = await registerDiner();
  const orderItem = { menuId: menuItem.id, description: menuItem.title, price: menuItem.price };
  const order = await DB.addDinerOrder(user, { franchiseId: franchise.id, storeId: store.id, items: [orderItem] });

  const ordersRes = await getOrders(token);
  expectResponse(ordersRes, 200, {
    dinerId: user.id,
    orders: [
      {
        id: order.id,
        franchiseId: franchise.id,
        storeId: store.id,
        date: expect.any(String),
        items: [{ ...orderItem, id: expect.any(Number) }],
      },
    ],
    page: 1,
  });
});

test('get orders responds 401 when auth header missing', async () => {
  const ordersRes = await request(app).get('/api/order');
  expectResponse(ordersRes, 401, { message: 'unauthorized' });
});

test('create order', async () => {
  const { user, token } = await registerDiner();
  const factoryFetch = mockFactory(true, { reportUrl: 'https://factory.test/report', jwt: 'factory.issued.jwt' });
  const orderReq = {
    franchiseId: franchise.id,
    storeId: store.id,
    items: [{ menuId: menuItem.id, description: menuItem.title, price: menuItem.price }],
  };

  const orderRes = await createOrder(token, orderReq);
  expect(orderRes.status).toBe(200);
  expect(orderRes.body).toMatchObject({
    order: { ...orderReq, id: expect.any(Number) },
    jwt: 'factory.issued.jwt',
  });

  expect(factoryFetch).toHaveBeenCalledTimes(1);
  const [, factoryReq] = factoryFetch.mock.calls[0];
  expect(factoryReq.headers.authorization).toMatch(/^Bearer /);
  expect(JSON.parse(factoryReq.body)).toEqual({
    diner: { id: user.id, name: user.name, email: user.email },
    order: orderRes.body.order,
  });
});

test('create order responds 404 and saves nothing when menu item does not exist', async () => {
  const { token } = await registerDiner();
  const factoryFetch = mockFactory(true, { reportUrl: 'https://factory.test/report', jwt: 'factory.issued.jwt' });
  const orderReq = {
    franchiseId: franchise.id,
    storeId: store.id,
    items: [{ menuId: -1, description: 'Not on the menu', price: 0.05 }],
  };

  const orderRes = await createOrder(token, orderReq);
  expect(orderRes.status).toBe(404);
  expect(factoryFetch).not.toHaveBeenCalled();

  const ordersRes = await getOrders(token);
  expect(ordersRes.body.orders).toEqual([]);
});

async function createAdminUser() {
  const user = { name: 'pizza admin', email: randomName() + '@admin.com', password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  await DB.addUser(user);
  return user;
}

async function registerDiner() {
  const diner = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(diner);
  expect(registerRes.status).toBe(200);
  return registerRes.body;
}

async function loginUser(user) {
  const loginRes = await request(app).put('/api/auth').send({ email: user.email, password: user.password });
  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

function addMenuItem(token, item) {
  return request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${token}`)
    .send(item);
}

function getOrders(token) {
  return request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${token}`);
}

function createOrder(token, orderReq) {
  return request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${token}`)
    .send(orderReq);
}

// Stand in for the pizza factory so tests never place real orders with the real API key.
function mockFactory(ok, body) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => body });
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function expectResponse(actualRes, expectedStatus, expectedBody) {
  expect(actualRes.status).toBe(expectedStatus);
  expect(actualRes.body).toEqual(expectedBody);
}
