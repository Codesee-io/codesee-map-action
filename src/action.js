const core = require("@actions/core");
const exec = require("@actions/exec");
const simpleGit = require("simple-git");

function setupEnv() {
  core.setSecret("api_token");
}

function getConfig() {
  const apiToken = core.getInput("api_token", { required: true });
  const webpackConfigPath = core.getInput("webpack_config_path", {
    required: false,
  });
  const supportTypescript = core.getBooleanInput("support_typescript", {
    required: false,
  });

  return {
    apiToken,
    webpackConfigPath:
      webpackConfigPath === "__NULL__" ? undefined : webpackConfigPath,
    supportTypescript,
  };
}

async function getRepoOrigin() {
  const git = simpleGit(".");
  const remotes = await git.getRemotes(true);
  const maybeOrigin = remotes.filter((r) => r.name === "origin");
  if (maybeOrigin.length !== 1) {
    throw new Error("Unable to determine origin remote");
  }

  const originFullUrl = maybeOrigin[0].refs.fetch || maybeOrigin[0].refs.push;

  // origins from github look like either `git@github.com:<owner name>/<repo name>`
  // or https://github.com/<owner name>/<repo name>`
  // and we only care about owner name and repo name to be able to find their
  // records
  const origin = originFullUrl
    .replace("git@github.com:", "")
    .replace("https://github.com/", "");
  core.info(`Using github repo ${origin} for the origin`);
  return origin;
}

async function runCodeseeMap(config) {
  const args = ["codesee", "map", "-o", "codesee.map.json"];

  if (config.webpackConfigPath) {
    args.push("-w", config.webpackConfigPath);
  }
  if (config.supportTypescript) {
    args.push("--typescript");
  }
  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function runCodeseeMapUpload(config, origin) {
  const args = [
    "codesee",
    "upload",
    "--type",
    "map",
    "--repo",
    `https://github.com/${origin}`,
    "-a",
    config.apiToken,
    "codesee.map.json",
  ];

  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function main() {
  core.startGroup("Setup");
  setupEnv();
  const config = getConfig();
  core.debug("CONFIG: ");
  core.debug(config);

  const origin = await core.group("Get Repo Origin", getRepoOrigin);
  core.endGroup();

  await core.group("Generate Map Data", async () => runCodeseeMap(config));
  await core.group("Upload Map to Codesee Server", async () =>
    runCodeseeMapUpload(config, origin)
  );
}

main()
  .then(() => {})
  .catch((err) => {
    const color = "\u001b[38;255;255;0m";
    core.info(`${color}CodeSee Map failed: ${err}
    ${err.stack}`);
  });
