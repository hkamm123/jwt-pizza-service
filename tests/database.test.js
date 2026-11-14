const logger = require('../src/logger.js');
const { DB } = require('../src/database/database.js');

afterAll(() => DB.initialized);

test('query logs the SQL but not the params', async () => {
  const spiedLogSql = jest.spyOn(logger, 'logSql');
  const connection = { execute: jest.fn().mockResolvedValue([[{ id: 1 }]]) };
  const rows = await DB.query(
    connection,
    'SELECT id FROM users WHERE email=?',
    ['user@example.com'],
  );

  expect(rows).toEqual([{ id: 1 }]);
  expect(spiedLogSql).toHaveBeenCalledWith(
    'SELECT id FROM users WHERE email=?',
  );
  expect(connection.execute).toHaveBeenCalledWith(
    'SELECT id FROM users WHERE email=?',
    ['user@example.com'],
  );
  expect(JSON.stringify(spiedLogSql.mock.calls[0])).not.toContain(
    'user@example.com',
  );
});
