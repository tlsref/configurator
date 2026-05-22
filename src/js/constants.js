module.exports = {
  contentSecurityPolicy: "default-src 'none'; base-uri 'none'; connect-src 'self' https://api-gateway.umami.dev https://data.tlsref.org; font-src 'self' https://code.cdn.mozilla.net; img-src 'self'; script-src 'self'; style-src 'self' https://code.cdn.mozilla.net 'sha256-+OsIn6RhyCZCUkkvtHxFtP0kU3CGdGeLjDd9Fzqdl3o='",
  description: "An easy-to-use secure configuration generator for web, database, and mail software. Simply select the software you are using and receive a configuration file that is both safe and compatible.",
  header: "TLS Configurator",
  localContentSecurityPolicy: "default-src * 'unsafe-inline'",  // supports autoreload
  mobileHeader: "TLS Configurator",
  title: "TLS Configurator",
  url: "https://configurator.tlsref.org",
  validHashKeys: ["server", "version", "server-version", "openssl", "openssl-version", "config", "hsts", "ocsp", "guideline"],
};
