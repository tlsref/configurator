import configs from './configs.js';
import minver from './helpers/minver.js';
import { xmlEntities } from './utils.js';

// note: guideln_latest for '6.0' is rendered as number 6 in guidelines[], not string '6.0'
const guideln_latest = '6.0'; // update when guideline changes
const guidelines = {};

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

export async function get_state({server, config, serverVersion, opensslVersion, guideln, hsts, ocsp, url = new URL('https://configurator.tlsref.org/'), gitrev = ''}) {
  if (!serverVersion) {
    serverVersion = configs[server].latestVersion;
  }
  if (!opensslVersion) {
    opensslVersion = configs.openssl.latestVersion;
  }
  if (guideln === '') {
    guideln = guideln_latest;
  }

  let sstls = guidelines[guideln];
  if (!sstls) {
      guideln = await fetch_guideline(guideln);
      if (guideln === '5.0') {
        if (await fetch_guideline('5.1') === '5.1') {
          // re-map keys from older guideline 5.0
          for (let x of ['modern', 'intermediate', 'old']) {
            let ss5 = guidelines['5.0'].configurations[x];  // server side tls config for that level
            ss5.ciphersuites = ss5.openssl_ciphersuites;
            ss5.ciphers = { // copy iana from 5.1 guideline
              iana: guidelines['5.1'].configurations[x].ciphers.iana,
              openssl: ss5.openssl_ciphers
            };
          }
        }
        else {
          guideln = guideln_latest;
        }
      }
      // note: sstls.version for '5.0' is rendered as number 5, not string '5.0'
      sstls = guidelines[guideln];
  }

  const available_configs = Object.keys(sstls.configurations);
  if (!available_configs.includes(config)) {
    console.error("Error: config '%s' is not available in guideline %s (use: %s)", config, guideln, available_configs.join(', '));
    return { form: undefined, output: undefined };
  }
  const ssc = sstls.configurations[config];  // server side tls config for that level
  const supportsOcspStapling =
    configs[server].supportsOcspStapling
    && minver(configs[server].supportsOcspStapling, serverVersion);

  const usesOpenssl = configs[server].usesOpenssl !== false;
  const supportsHsts = configs[server].supportsHsts !== false && hsts;

  // generate the fragment
  let fragment = `server=${server}&version=${serverVersion}&config=${config}`;
  fragment += usesOpenssl ? `&openssl=${opensslVersion}` : '';
  fragment += supportsHsts ? '&hsts' : '';
  fragment += supportsOcspStapling && ocsp ? '&ocsp' : '';
  fragment += `&guideline=${guideln}`;

  // generate the version tags
  let version_tags = `${configs[server].name} ${serverVersion}`;
  if (configs[server].eolBefore
      && !minver(configs[server].eolBefore, serverVersion)) {
    version_tags += ' (UNSUPPORTED; end-of-life)';
  }
  if (configs[server].usesOpenssl !== false) {
    version_tags += `, OpenSSL ${opensslVersion}`;
    if (!minver(configs['openssl'].eolBefore, opensslVersion)) {
      version_tags += ' (UNSUPPORTED; end-of-life)';
    }
    else if (!minver("3.5.0", opensslVersion)
             && minver("5.8", guideln)) {
      version_tags += ' (OLD: missing PQC hybrid MLKEMs)';
    }
  }
  version_tags += `, ${config} config`;

  // html-escape version_tags (even though version_tags is also used
  // outside HTML contexts, HTML is not expected in version strings)
  version_tags = xmlEntities(version_tags);

  // generate the header
  const date = new Date().toISOString().substr(0, 10);
  let header = `generated ${date}, TLSRef Guideline v${guideln}, ${version_tags}`;
  header += supportsHsts ? ', HSTS' : '';
  header += supportsOcspStapling && ocsp ? ', OCSP' : '';
  header += gitrev ? `, gitrev=${gitrev}` : '';

  const link = `${url.origin}${url.pathname}#${fragment}`;

  // we need to remove TLS 1.3 from the supported protocols if the software is too old
  let protocols = ssc.tls_versions;
  if (!configs[server].tls13
      || !minver(configs[server].tls13, serverVersion)
      || !minver(configs['openssl'].tls13, opensslVersion)) {
    protocols = protocols.filter(ciphers => ciphers !== 'TLSv1.3');
  }
  let tlsCurves = ssc.tls_curves;
  if (!minver('3.5.0', opensslVersion)) {
    // future: may need to filter 'X25519MLKEM768','SecP256r1MLKEM768','SecP384r1MLKEM1024'
    tlsCurves = tlsCurves.filter(groups => groups !== 'X25519MLKEM768');
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
  if (configs[server].usesOpenssl !== false && minver('3.0.0', opensslVersion)) {
    // set SECLEVEL=0 via cipher string to support TLSv1-1.1 "old" with OpenSSL 3.x
    if (protocols.includes('TLSv1.1')) ciphers.unshift('@SECLEVEL=0');
  }

  return {
    form: {
      config,
      hsts: supportsHsts,
      ocsp: ocsp && supportsOcspStapling,
      opensslVersion,
      server,
      serverName: configs[server].name,
      serverVersion,
      version_tags,
    },
    output: {
      ciphers,
      cipherSuites: ssc.ciphersuites,
      date,
      dhCommand: `curl https://data.tlsref.org/ffdhe/ffdhe${ssc.dh_param_size}.txt`,
      dhParamSize: ssc.dh_param_size,
      fragment,
      hasVersions: configs[server].hasVersions !== false,
      header,
      hstsMaxAge: ssc.hsts_min_age,
      //hstsRedirectCode: config === 'old' ? 301 : 308,
      hstsRedirectCode: 308,
      latestVersion: configs[server].latestVersion,
      link,
      oldestClients: ssc.oldest_clients,
      origin: url.origin,
      protocols,
      serverPreferredOrder: ssc.server_preferred_order,
      showSupports: configs[server].showSupports !== false,
      supportsHsts: configs[server].supportsHsts !== false,
      supportsOcspStapling,
      tlsCurves,
      // XXX: If DHE ciphers removed from guidelines, then usesDhe, dhCommand,
      //      dhParamSize, and helpers/*.js code which uses them can be removed
      usesDhe: ciphers.join(":").includes(":DHE") || ciphers.join(":").includes("_DHE_"),
      usesOpenssl,
    },
  }
}

export default async function () {

  const form = document.getElementById('form-generator').elements;

  return get_state({
    server: form['server'].value,
    config: form['config'].value,
    serverVersion: form['version'].value,
    opensslVersion: form['openssl'].value,
    guideln: form['guideline'].value,
    hsts: !!form['hsts'].checked,
    ocsp: !!form['ocsp'].checked,
    url: new URL(document.location),
    gitrev: document.getElementById('gitrev').value,
  })
};
