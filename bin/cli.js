import { parseArgs } from 'util';
import configs from '../src/js/configs.js';
import minver from '../src/js/helpers/minver.js';
import { xmlEntities } from '../src/js/utils.js';

const guideln_latest = '6.0';
const guidelines = {};
const servers = Object.keys(configs).filter(k => k !== 'openssl');

async function fetch_guideline(guideln) {
  // check for numerical version string, e.g. digit.digit
  if (isNaN(guideln) || isNaN(parseFloat(guideln))) {
    return guideln_latest; // invalid numerical version string
  }
  const url = `https://data.tlsref.org/guidelines/${guideln}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`error retrieving ${url}: ${response.status}`);
    }

    guidelines[guideln] = await response.json();
    return guideln;
  } catch (error) {
    console.error("Error: %s", error.message);
    return guideln_latest;
  }
}

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
    return;
  }

  if (!values.server) {
    console.error('Error: --server is required');
    show_help();
    process.exit(1);
  }

  if (!servers.includes(values.server)) {
    console.error("Error: unknown server '%s'. Available servers: %s", values.server, servers.join(', '));
    process.exit(1);
  }

  if (!values.config) {
    console.error('Error: --config is required (modern, intermediate, old)');
    process.exit(1);
  }

  const server = values.server;
  const config = values.config;
  const serverVersion = values.version || configs[server].latestVersion;
  const opensslVersion = values.openssl || configs.openssl.latestVersion;
  let guideln = values.guideline || guideln_latest;

  if (!guidelines[guideln]) {
    guideln = await fetch_guideline(guideln);
    if (guideln === '5.0') {
      if (await fetch_guideline('5.1') === '5.1') {
        // re-map keys from older guideline 5.0
        for (let x of ['modern', 'intermediate', 'old']) {
          let ss5 = guidelines['5.0'].configurations[x];  // server side tls config for that level
          ss5.ciphersuites = ss5.openssl_ciphersuites;
          ss5.ciphers = { // copy iana from 5.1 guideline
            iana: guidelines['5.1'].configurations[x].ciphers.iana,
            openssl: ss5.openssl_ciphers,
          };
        }
      } else {
        guideln = guideln_latest;
      }
    }
  }

  const sstls = guidelines[guideln];
  const available_configs = Object.keys(sstls.configurations);
  if (!available_configs.includes(config)) {
    console.error("Error: config '%s' is not available in guideline %s (use: %s)", config, guideln, available_configs.join(', '));
    process.exit(1);
  }
  const ssc = sstls.configurations[config];

  const supportsOcspStapling =
    configs[server].supportsOcspStapling
    && minver(configs[server].supportsOcspStapling, serverVersion);

  const usesOpenssl = configs[server].usesOpenssl !== false;

  let fragment = `server=${server}&version=${serverVersion}&config=${config}`;
  fragment += usesOpenssl ? `&openssl=${opensslVersion}` : '';
  fragment += configs[server].supportsHsts !== false && values.hsts ? '&hsts' : '';
  fragment += supportsOcspStapling && values.ocsp ? '&ocsp' : '';
  fragment += `&guideline=${guideln}`;

  let version_tags = `${configs[server].name} ${serverVersion}`;
  if (configs[server].eolBefore
      && !minver(configs[server].eolBefore, serverVersion)) {
    version_tags += ' (UNSUPPORTED; end-of-life)';
  }
  if (usesOpenssl) {
    version_tags += `, OpenSSL ${opensslVersion}`;
    if (!minver(configs['openssl'].eolBefore, opensslVersion)) {
      version_tags += ' (UNSUPPORTED; end-of-life)';
    }
    else if (!minver('3.5.0', opensslVersion)
             && minver('5.8', guideln)) {
      version_tags += ' (OLD: missing PQC hybrid MLKEMs)';
    }
  }
  version_tags += `, ${config} config`;

  // html-escape version_tags (even though version_tags is also used
  // outside HTML contexts, HTML is not expected in version strings)
  version_tags = xmlEntities(version_tags);

  const date = new Date().toISOString().substr(0, 10);
  let header = `generated ${date}, TLSRef Guideline v${guideln}, ${version_tags}`;
  header += configs[server].supportsHsts !== false && values.hsts ? ', HSTS' : '';
  header += supportsOcspStapling && values.ocsp ? ', OCSP' : '';

  const link = 'https://configurator.tlsref.org/#' + fragment;

  // we need to remove TLS 1.3 from the supported protocols if the software is too old
  let protocols = ssc.tls_versions;
  if (!configs[server].tls13
      || !minver(configs[server].tls13, serverVersion)
      || !minver(configs['openssl'].tls13, opensslVersion)) {
    protocols = protocols.filter(p => p !== 'TLSv1.3');
  }
  let tlsCurves = ssc.tls_curves;
  if (!minver('3.5.0', opensslVersion)) {
    // future: may need to filter 'X25519MLKEM768','SecP256r1MLKEM768','SecP384r1MLKEM1024'
    tlsCurves = tlsCurves.filter(g => g !== 'X25519MLKEM768');
  }

  const cipherFormat = configs[server].cipherFormat ? configs[server].cipherFormat : 'openssl';
  let ciphers = cipherFormat === 'go' ? ssc.ciphers['iana'] : ssc.ciphers[cipherFormat];
  const supportedCiphers = configs[server].supportedCiphers
    ? configs[server].supportedCiphers
    : cipherFormat === 'go' ? configs['go'].supportedCiphers : null;
  if (supportedCiphers) {
    ciphers = ciphers.filter(suite => supportedCiphers.indexOf(suite) !== -1);
  }
  if (ciphers.length && ciphers[0] === '@SECLEVEL=0') ciphers.shift();
  if (usesOpenssl && minver('3.0.0', opensslVersion)) {
    if (protocols.includes('TLSv1.1')) ciphers.unshift('@SECLEVEL=0');
  }

  const form = {
    config,
    hsts: !!values.hsts && configs[server].supportsHsts !== false,
    ocsp: !!values.ocsp && !!supportsOcspStapling,
    opensslVersion,
    server,
    serverName: configs[server].name,
    serverVersion,
    version_tags,
  };

  const output = {
    ciphers,
    cipherSuites: ssc.ciphersuites,
    date,
    dhCommand: 'curl https://data.tlsref.org/ffdhe/ffdhe' + ssc.dh_param_size + '.txt',
    dhParamSize: ssc.dh_param_size,
    fragment,
    hasVersions: configs[server].hasVersions !== false,
    header,
    hstsMaxAge: ssc.hsts_min_age,
    //hstsRedirectCode: form['config'].value === 'old' ? 301 : 308,
    hstsRedirectCode: 308,
    latestVersion: configs[server].latestVersion,
    link,
    oldestClients: ssc.oldest_clients,
    origin: 'https://configurator.tlsref.org',
    protocols,
    serverPreferredOrder: ssc.server_preferred_order,
    showSupports: configs[server].showSupports !== false,
    supportsHsts: configs[server].supportsHsts !== false,
    supportsOcspStapling: !!supportsOcspStapling,
    tlsCurves,
    // XXX: If DHE ciphers removed from guidelines, then usesDhe, dhCommand,
    //      dhParamSize, and helpers/*.js code which uses them can be removed
    usesDhe: ciphers.join(':').includes(':DHE') || ciphers.join(':').includes('_DHE_'),
    usesOpenssl,
  };

  if (protocols.length === 0) {
    console.error('# unfortunately, %s is not supported with these software versions.', version_tags);
    process.exit(1);
  }

  const template = require('../src/js/helpers/' + server + '.js').default;
  process.stdout.write(template(form, output));
}

main().catch(err => {
  console.error('Error: %s', err.message);
  process.exit(1);
});
