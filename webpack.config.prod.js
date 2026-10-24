const CopyPlugin = require('copy-webpack-plugin');
const common = require('./webpack.common.js');

module.exports = {
  ...common,
  mode: 'production',
  // Sprite sheets and music are big on purpose; size hints would only be noise.
  performance: { hints: false },
  plugins: [
    ...common.plugins,
    new CopyPlugin({
      patterns: [
        // Site-wide: the root page (forwards to crazyarcade/) and shared icons.
        { from: 'index.html', to: 'index.html' },
        { from: 'robots.txt', to: 'robots.txt' },
        { from: '*.png', to: '[name][ext]' },
        { from: 'sw.js', to: 'sw.js' },
        { from: '404.html', to: '404.html' },
        { from: 'site.webmanifest', to: 'site.webmanifest' },
        { from: 'crazyarcade/index.html', to: 'crazyarcade/index.html' },
        { from: 'crazyarcade/css', to: 'crazyarcade/css' },
        { from: 'crazyarcade/assets/ca', to: 'crazyarcade/assets/ca', noErrorOnMissing: true },
      ],
    }),
  ],
};
