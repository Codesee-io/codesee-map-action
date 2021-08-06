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
  const githubRef =
    process.env.GITHUB_HEAD_REF ||
    core.getInput("github_ref", { required: false });
  const githubBaseRef = process.env.GITHUB_BASE_REF;

  return {
    apiToken,
    webpackConfigPath:
      webpackConfigPath === "__NULL__" ? undefined : webpackConfigPath,
    supportTypescript,
    githubBaseRef,
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
  const githubEventName = process.env.GITHUB_EVENT_NAME;
  let githubEventData = {};

  if (githubEventName === "pull_request") {
    githubEventData = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH));
    const headRepoFullName = githubEventData.pull_request.head.repo.full_name;
    const baseRepoFullName = githubEventData.pull_request.base.repo.full_name;

    if (headRepoFullName !== baseRepoFullName) {
      core.info(
        `Pull request head repository ${headRepoFullName} differs from base repository ${baseRepoFullName}. Not running.`
      );
      return { passedPreflight: false, githubEventName, githubEventData };
    }
  }

  return { passedPreflight: true, githubEventName, githubEventData };
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

async function runCodeseeMapUpload(
  config,
  origin,
  githubEventName,
  githubEventData
) {
  const additionalArguments = config.githubRef ? ["-f", config.githubRef] : [];

  if (githubEventName === "pull_request") {
    additionalArguments.push("-b", config.githubBaseRef);
    additionalArguments.push("-s", githubEventData.pull_request.base.sha);
    additionalArguments.push("-p", githubEventData.number.toString());
  }

  const args = [
    "codesee",
    "upload",
    "--type",
    "map",
    "--repo",
    `https://github.com/${origin}`,
    "-a",
    config.apiToken,
    ...additionalArguments,
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
  const { passedPreflight, githubEventName, githubEventData } =
    await core.group("Check If Action Should Run", runPreflight);
  core.endGroup();

  if (!passedPreflight) {
    return;
  }

  await core.group("Generate Map Data", async () => runCodeseeMap(config));
  await core.group("Upload Map to Codesee Server", async () =>
    runCodeseeMapUpload(config, origin, githubEventName, githubEventData)
  );
}

main()
  .then(() => {})
  .catch((err) => {
    core.info(`CodeSee Map failed: ${err}
    ${err.stack}`);
  });
