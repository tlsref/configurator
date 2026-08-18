const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const production = process.env.NODE_ENV === 'production';

class ChmodExecutablePlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('ChmodExecutablePlugin', (compilation) => {
      for (const assetName of compilation.getAssets().map((asset) => asset.name)) {
        fs.chmodSync(path.join(compilation.outputOptions.path, assetName), 0o755);
      }
    });
  }
}

module.exports = {
  target: 'node',
  mode: production ? 'production' : 'development',
  devtool: production ? undefined : 'source-map',
  entry: path.resolve(__dirname, '..', 'src', 'js', 'cli.js'),
  output: {
    path: production ? path.resolve(__dirname, '..', 'bin') : path.resolve(__dirname, '..', 'build'),
    filename: '[contenthash].tlsref.js'
  },
  stats: {
    errorDetails: true,
    children: true
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: path.resolve(__dirname, '..', 'src'),
        exclude: path.resolve(__dirname, '..', 'src', 'js', 'index.js'),
        use: [{
          loader: 'babel-loader',
          options: {
            babelrc: false,
            plugins: [
              '@babel/plugin-transform-object-rest-spread'
            ],
            presets: [
              ['@babel/preset-env', {
                'targets': {
                  'node': 'current'
                },
                'shippedProposals': true
              }]
            ]
          }
        }]
      }
    ]
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: '#!/usr/bin/env node',
      raw: true
    }),
    new ChmodExecutablePlugin()
  ]
};
