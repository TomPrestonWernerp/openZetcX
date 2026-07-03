const os = require("os");
const path = require("path");
const fs = require("fs");

const PI_SDK_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

function expandHome(input, homeDir = os.homedir()) {
  if (!input) return input;
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~" + path.sep)) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

function resolveOpenZetcXHome(input, homeDir = os.homedir()) {
  const raw = input || path.join(homeDir, ".openZetcX");
  return path.resolve(expandHome(raw, homeDir));
}

function resolveHanaPiRoot(openZetcXHome) {
  if (!openZetcXHome || typeof openZetcXHome !== "string") {
    throw new Error("resolveHanaPiRoot: openZetcXHome is required");
  }
  return path.join(openZetcXHome, ".pi");
}

function resolveHanaPiAgentDir(openZetcXHome) {
  return path.join(resolveHanaPiRoot(openZetcXHome), "agent");
}

function resolveHanaPiProjectDir(openZetcXHome) {
  return path.join(resolveHanaPiRoot(openZetcXHome), "project");
}

function withHanaPiSdkEnv(env, openZetcXHome) {
  return {
    ...env,
    [PI_SDK_AGENT_DIR_ENV]: resolveHanaPiAgentDir(openZetcXHome),
  };
}

function ensureHanaPiSdkDirs(openZetcXHome) {
  fs.mkdirSync(resolveHanaPiAgentDir(openZetcXHome), { recursive: true });
  fs.mkdirSync(resolveHanaPiProjectDir(openZetcXHome), { recursive: true });
}

function configureProcessPiSdkEnv(openZetcXHome, env = process.env) {
  const agentDir = resolveHanaPiAgentDir(openZetcXHome);
  env[PI_SDK_AGENT_DIR_ENV] = agentDir;
  return agentDir;
}

module.exports = {
  PI_SDK_AGENT_DIR_ENV,
  configureProcessPiSdkEnv,
  ensureHanaPiSdkDirs,
  resolveOpenZetcXHome,
  resolveHanaPiAgentDir,
  resolveHanaPiProjectDir,
  resolveHanaPiRoot,
  withHanaPiSdkEnv,
};
