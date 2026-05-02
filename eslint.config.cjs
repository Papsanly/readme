const { defineConfig } = require('eslint/config');
// @ts-expect-error - no types published for eslint-config-expo/flat
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  { ignores: ['dist/*'] }
]);
