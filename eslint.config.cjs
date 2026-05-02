const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' }
      }
    }
  },
  { ignores: ['dist/*'] }
]);
