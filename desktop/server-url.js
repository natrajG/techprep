function validateServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TECHPREP_SERVER_URL must be an absolute HTTPS server URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("TECHPREP_SERVER_URL must use HTTPS with no credentials, path, query, or fragment.");
  }
  return url.href;
}

function resolveAppUrl({ isPackaged, env, metadata }) {
  if (env.APP_URL) return env.APP_URL;
  if (isPackaged) return validateServerUrl(metadata.techprepServerUrl);
  return `http://127.0.0.1:${env.PORT || "8000"}/`;
}

const NON_PUBLIC_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".test", ".invalid", ".example"];

// Production installers must use a publicly trusted DNS name, never a LAN address or private CA.
function validatePublicServerUrl(value) {
  const href = validateServerUrl(value);
  const { hostname, port } = new URL(href);
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (port || require("node:net").isIP(bareHost) || !hostname.includes(".") ||
      hostname === "localhost" || NON_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("TECHPREP_SERVER_URL must be a public DNS hostname on the default HTTPS port.");
  }
  return href;
}

module.exports = { validateServerUrl, validatePublicServerUrl, resolveAppUrl };
