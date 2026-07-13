#!/usr/bin/env node
'use strict';

// Used to run tlsref directly, without needing to build it with webpack
// first.

const babel = require('@babel/core');
const Module = require('module');
const fs = require('fs');

// Hook into Node's module loader to transform ES module syntax in source files
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (mod, filename) {
  if (filename.includes('node_modules')) {
    return original(mod, filename);
  }
  const code = fs.readFileSync(filename, 'utf8');
  const result = babel.transformSync(code, {
    filename,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    plugins: ['@babel/plugin-transform-object-rest-spread'],
  });
  mod._compile(result.code, filename);
};

require('../src/js/cli.js');
