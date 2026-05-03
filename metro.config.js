const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The vendored pdf.js library + worker under `assets/pdfjs/` are committed
// with a `.txt` suffix so Metro never tries to parse them as source. We read
// them at runtime via `expo-asset` and inline the contents into a WebView
// shell. `.txt` is not a default asset extension, so register it here.
if (!config.resolver.assetExts.includes('txt')) {
  config.resolver.assetExts = [...config.resolver.assetExts, 'txt'];
}

module.exports = config;
