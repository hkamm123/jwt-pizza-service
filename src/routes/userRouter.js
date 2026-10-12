const express = require('express');
const { asyncHandler, parseQueryInt } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: {
      id: 1,
      name: '常用名字',
      email: 'a@jwt.com',
      roles: [{ role: 'admin' }],
    },
  },
  {
    method: 'GET',
    path: '/api/user?page=0&limit=10&name=*',
    requiresAuth: true,
    description: 'Gets a list of users. Admin only',
    example: `curl -X GET 'localhost:3000/api/user?page=0&limit=10&name=pizza*' -H 'Authorization: Bearer tttttt'`,
    response: {
      users: [
        {
          id: 1,
          name: '常用名字',
          email: 'a@jwt.com',
          roles: [{ role: 'admin' }],
        },
      ],
      more: true,
    },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: {
      user: {
        id: 1,
        name: '常用名字',
        email: 'a@jwt.com',
        roles: [{ role: 'admin' }],
      },
      token: 'tttttt',
    },
  },
  {
    method: 'DELETE',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Delete user',
    example: `curl -X DELETE localhost:3000/api/user/1 -H 'Authorization: Bearer tttttt'`,
    response: { message: 'User deleted successfully' },
  },
];

// getUser
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  }),
);

// listUsers
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }
    const page = parseQueryInt(req.query.page);
    const limit = parseQueryInt(req.query.limit);
    if (limit === 0 || limit > 100) {
      return res.status(400).json({ message: 'bad request' });
    }
    if (req.query.name && typeof req.query.name !== 'string') {
      return res.status(400).json({ message: 'bad request' });
    }
    const [users, more] = await DB.getUsers(page, limit, req.query.name);
    res.json({ users, more });
  }),
);

// updateUser
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  }),
);

// deleteUser
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const userId = parseQueryInt(req.params.userId);
    if (userId === req.user.id) {
      return res.status(403).json({ message: 'cannot delete yourself' });
    }

    await DB.deleteUser(userId);
    res.json({ message: 'User deleted successfully' });
  }),
);

module.exports = userRouter;
