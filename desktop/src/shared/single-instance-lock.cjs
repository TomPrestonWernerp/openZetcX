/**
 * Electron client single-instance guard.
 *
 * Electron's requestSingleInstanceLock() is scoped by userData, so Hana sets
 * userData from HANA_HOME before requesting the lock. Production and dev homes
 * get different namespaces, while duplicate launches within the same home are
 * redirected to the first client.
 */
const path = require("path");

function normalizeForCompare(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getUserDataAppName(openZetcXHome, defaultHome) {
  if (normalizeForCompare(openZetcXHome) === normalizeForCompare(defaultHome)) {
    return null;
  }
  const suffix = path.basename(openZetcXHome).replace(/^\./, "");
  if (!suffix) return "openZetcX";
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

function exitDuplicateClient(app) {
  if (typeof app.exit === "function") {
    app.exit(0);
    return;
  }
  app.quit();
}

function focusExistingWindow(win) {
  if (!win || win.isDestroyed?.()) return false;
  if (win.isMinimized?.()) win.restore?.();
  win.show?.();
  win.focus?.();
  return true;
}

function configureClientSingleInstance(app, opts) {
  const { openZetcXHome, defaultHome, onSecondInstance } = opts;
  const appName = getUserDataAppName(openZetcXHome, defaultHome);
  if (appName) {
    app.setPath("userData", path.join(app.getPath("appData"), appName));
  }

  const gotLock = app.requestSingleInstanceLock({ openZetcXHome });
  if (!gotLock) {
    exitDuplicateClient(app);
    return false;
  }

  app.on("second-instance", () => {
    onSecondInstance?.();
  });
  return true;
}

module.exports = {
  configureClientSingleInstance,
  focusExistingWindow,
  getUserDataAppName,
};
