// Metro config so the app can consume the workspace packages (e.g. @vintrace/decision-layer),
// which live outside the app dir at ../packages/*. Watch the monorepo root and alias the package
// to its TypeScript source — Metro transpiles it like any other in-tree source.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  '@vintrace/decision-layer': path.resolve(monorepoRoot, 'packages/decision-layer/src'),
};

module.exports = config;
