const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Treat `.mjs` as a bundled asset so `require('./*.mjs')` returns an asset
// module URI instead of being parsed as JavaScript. This is required for the
// vendored pdf.js files under `assets/pdfjs/`, which we read at runtime via
// `expo-asset` and inline into the WebView shell. We also strip `mjs` from
// `sourceExts` so Metro never tries to resolve those files as code.
config.resolver.sourceExts = config.resolver.sourceExts.filter(ext => ext !== 'mjs');
if (!config.resolver.assetExts.includes('mjs')) {
  config.resolver.assetExts.push('mjs');
}

module.exports = config;
