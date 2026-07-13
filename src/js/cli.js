import { parseArgs } from 'util';
import configs from './configs.js';
import minver from './helpers/minver.js';
import { xmlEntities } from './utils.js';
import { get_state, guideln_latest } from './state.js';

const servers = Object.keys(configs).filter(k => k !== 'openssl');

function show_help() {
  process.stdout.write(
    'Usage: tlsref --server <server> --config <config> [options]\n' +
    '\n' +
    'Options:\n' +
    '  -s, --server <server>      Server software (required)\n' +
    '  -c, --config <config>      Configuration level: modern, intermediate, old (required)\n' +
    '  -v, --version <version>    Server software version (default: latest)\n' +
    '  -o, --openssl <version>    OpenSSL version (default: latest)\n' +
    '      --hsts                 Enable HSTS (when supported)\n' +
    '      --ocsp                 Enable OCSP stapling (when supported)\n' +
    '  -g, --guideline <version>  Guideline version (default: ' + guideln_latest + ')\n' +
    '  -h, --help                 Show this help message\n' +
    '\n' +
    'Available servers: ' + servers.join(', ') + '\n'
  );
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      server:    { type: 'string',  short: 's' },
      config:    { type: 'string',  short: 'c' },
      version:   { type: 'string',  short: 'v' },
      openssl:   { type: 'string',  short: 'o' },
      guideline: { type: 'string',  short: 'g' },
      hsts:      { type: 'boolean' },
      ocsp:      { type: 'boolean' },
      help:      { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    show_help();
    return 0;
  }

  if (!values.server) {
    console.error('Error: --server is required');
    show_help();
    return 1;
  }

  if (!servers.includes(values.server)) {
    throw new Error(`unknown server '${values.server}'. Available servers: ${servers.join(', ')}`);
  }

  if (!values.config) {
    throw new Error('--config is required (modern, intermediate, old)');
  }

  const { form, output } = await get_state({
    server: values.server,
    config: values.config,
    serverVersion: values.version,
    opensslVersion: values.openssl,
    guideln: values.guideline,
    hsts: values.hsts,
    ocsp: values.ocsp,
  });
  if (!form || !output) {
    return 1;
  }

  if (output.protocols.length === 0) {
    process.stdout.write(`# unfortunately, ${form.version_tags} is not supported with these software versions.\n`);
    return 1;
  }

  const template = require('./helpers/' + values.server + '.js').default;
  process.stdout.write(template(form, output));

  return 0;
}

main().catch(err => {
  console.error('Error: %s', err.message);
  return 1;
}).then(exitCode => {
  process.exit(exitCode);
});
