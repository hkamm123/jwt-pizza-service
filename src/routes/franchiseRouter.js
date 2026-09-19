const express = require('express');
const { DB, Role } = require('../database/database.js');
const { authRouter } = require('./authRouter.js');
const { StatusCodeError, asyncHandler } = require('../endpointHelper.js');

const franchiseRouter = express.Router();

franchiseRouter.docs = [
  {
    method: 'GET',
    path: '/api/franchise?page=0&limit=10&name=*',
    description: 'List all the franchises',
    example: `curl localhost:3000/api/franchise&page=0&limit=10&name=pizzaPocket`,
    response: { franchises: [{ id: 1, name: 'pizzaPocket', admins: [{ id: 4, name: 'pizza franchisee', email: 'f@jwt.com' }], stores: [{ id: 1, name: 'SLC', totalRevenue: 0 }] }], more: true },
  },
  {
    method: 'GET',
    path: '/api/franchise/:userId',
    requiresAuth: true,
    description: `List a user's franchises`,
    example: `curl localhost:3000/api/franchise/4  -H 'Authorization: Bearer tttttt'`,
    response: [{ id: 2, name: 'pizzaPocket', admins: [{ id: 4, name: 'pizza franchisee', email: 'f@jwt.com' }], stores: [{ id: 4, name: 'SLC', totalRevenue: 0 }] }],
  },
  {
    method: 'POST',
    path: '/api/franchise',
    requiresAuth: true,
    description: 'Create a new franchise',
    example: `curl -X POST localhost:3000/api/franchise -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt' -d '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}'`,
    response: { name: 'pizzaPocket', admins: [{ email: 'f@jwt.com', id: 4, name: 'pizza franchisee' }], id: 1 },
  },
  {
    method: 'DELETE',
    path: '/api/franchise/:franchiseId',
    requiresAuth: true,
    description: `Delete a franchise`,
    example: `curl -X DELETE localhost:3000/api/franchise/1 -H 'Authorization: Bearer tttttt'`,
    response: { message: 'franchise deleted' },
  },
  {
    method: 'POST',
    path: '/api/franchise/:franchiseId/store',
    requiresAuth: true,
    description: 'Create a new franchise store',
    example: `curl -X POST localhost:3000/api/franchise/1/store -H 'Content-Type: application/json' -d '{"franchiseId": 1, "name":"SLC"}' -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: 'SLC', totalRevenue: 0 },
  },
  {
    method: 'DELETE',
    path: '/api/franchise/:franchiseId/store/:storeId',
    requiresAuth: true,
    description: `Delete a store`,
    example: `curl -X DELETE localhost:3000/api/franchise/1/store/1  -H 'Authorization: Bearer tttttt'`,
    response: { message: 'store deleted' },
  },
];

// getFranchises
franchiseRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = parseQueryInt(req.query.limit);
    const page = parseQueryInt(req.query.page);
    const [franchises, more] = await DB.getFranchises(req.user, page, limit, req.query.name);
    res.json({ franchises, more });
  })
);

// getUserFranchises
franchiseRouter.get(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (req.user.id === userId || req.user.isRole(Role.Admin)) {
      res.json(await DB.getUserFranchises(userId));
    } else {
      res.status(403).json({ message: 'unauthorized' });
    }
  })
);

// createFranchise
franchiseRouter.post(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to create a franchise', 403);
    }

    const { name, admins } = req.body;
    const validName = typeof name === 'string' && name.trim() !== '';
    const validAdmins = Array.isArray(admins) && admins.every((admin) => typeof admin?.email === 'string');
    if (!validName || !validAdmins) {
      throw new StatusCodeError('bad request', 400);
    }

    // Build the franchise from only the fields we expect so extra body fields aren't echoed back.
    const franchise = { name, admins: admins.map((admin) => ({ email: admin.email })) };
    res.send(await DB.createFranchise(franchise));
  })
);

// deleteFranchise
franchiseRouter.delete(
  '/:franchiseId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to delete a franchise', 403);
    }

    const franchiseId = Number(req.params.franchiseId);
    await DB.deleteFranchise(franchiseId);
    res.json({ message: 'franchise deleted' });
  })
);

// createStore
franchiseRouter.post(
  '/:franchiseId/store',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId);
    const franchise = await DB.getFranchise({ id: franchiseId });
    if (!franchise || (!req.user.isRole(Role.Admin) && !franchise.admins.some((admin) => admin.id === req.user.id))) {
      throw new StatusCodeError('unable to create a store', 403);
    }

    const { name } = req.body;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new StatusCodeError('name is required', 400);
    }

    res.send(await DB.createStore(franchise.id, { name }));
  })
);

// deleteStore
franchiseRouter.delete(
  '/:franchiseId/store/:storeId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId);
    const franchise = await DB.getFranchise({ id: franchiseId });
    if (!franchise || (!req.user.isRole(Role.Admin) && !franchise.admins.some((admin) => admin.id === req.user.id))) {
      throw new StatusCodeError('unable to delete a store', 403);
    }

    const storeId = Number(req.params.storeId);
    await DB.deleteStore(franchiseId, storeId);
    res.json({ message: 'store deleted' });
  })
);

function parseQueryInt(value) {
  if (value === undefined) {
    return value;
  }

  if (!/^\d+$/.test(value)) {
    throw new StatusCodeError('bad request', 400);
  }

  return Number(value);
}

module.exports = franchiseRouter;
