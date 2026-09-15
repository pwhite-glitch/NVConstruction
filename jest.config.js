/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  transform: {
    '^.+\\.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  moduleNameMapper: {
    // Stub out Next.js server imports not available in test env
    '^next/server$': '<rootDir>/tests/__mocks__/next-server.js',
  },
}

module.exports = config
