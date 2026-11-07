const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['src/types/contract.d.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      eqeqeq: 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
];
