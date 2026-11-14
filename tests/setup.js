const logger = require('../src/logger.js');

// Never send logs to the real Grafana server from tests. This runs before every
// test (not once per file) because some test files call jest.restoreAllMocks()
// after each test, which would undo it.
beforeEach(() => {
  jest.spyOn(logger, 'sendLogToGrafana').mockImplementation(() => {});
});
