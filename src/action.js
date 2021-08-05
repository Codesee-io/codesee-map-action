const fs = require("fs");
const core = require("@actions/core");
const exec = require("@actions/exec");
const simpleGit = require("simple-git");

/**
 * Asynchronously reads the contents of a file.
 * @param {string} filePath - The path of the file you want to read.
 * @returns {Promise<string>} The contents of the file as a string.
 */
async function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, { encoding: "utf-8" }, (err, data) => {
      if (err) {
        return reject(err);
      }
      resolve(data.toString());
    });
  });
}

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
  const githubRef = core.getInput("github_ref", { required: false });

  return {
    apiToken,
    webpackConfigPath:
      webpackConfigPath === "__NULL__" ? undefined : webpackConfigPath,
    supportTypescript,
    githubRef,
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

async function runPreflight() {
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const eventData = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH));
    const headRepoFullName = eventData.pull_request.head.repo.full_name;
    const baseRepoFullName = eventData.pull_request.base.repo.full_name;

    if (headRepoFullName !== baseRepoFullName) {
      core.info(`Pull request head repository ${headRepoFullName} differs from base repository ${baseRepoFullName}. Not running.`);
      return false;
    }
  }

  core.info("Passed preflight checks.");
  return true;
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
  const refArguments = config.githubRef ? ["-f", config.githubRef] : [];
  const args = [
    "codesee",
    "upload",
    "--type",
    "map",
    "--repo",
    `https://github.com/${origin}`,
    "-a",
    config.apiToken,
    ...refArguments,
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
  const passesPreflight = await core.group(
    "Check If Action Should Run",
    runPreflight
  );
  core.endGroup();

  if (!passesPreflight) {
    return;
  }

  await core.group("Generate Map Data", async () => runCodeseeMap(config));
  await core.group("Upload Map to Codesee Server", async () =>
    runCodeseeMapUpload(config, origin)
  );
}

main()
  .then(() => {})
  .catch((err) => {
    core.info(`CodeSee Map failed: ${err}
    ${err.stack}`);
  });
