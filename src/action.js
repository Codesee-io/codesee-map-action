const fs = require("fs");
const core = require("@actions/core");
const exec = require("@actions/exec");
const simpleGit = require("simple-git");
const insightsAction = require("./insights");

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
  const skipUpload = core.getBooleanInput("skip_upload", {
    required: false,
  });

  // UNIX convention is that command line arguments should take precedence
  // over environment variables. We're breaking from this convention below
  // because when this action runs on a pull request, we want to use the
  // value of process.env.GITHUB_HEAD_REF in preference to the input
  // github_ref. The value in github_ref is also available in
  // process.env.GITHUB_REF, but it may be an error to pass an input in to
  // an action that is not used.
  // TODO: CODESEE-1474 see if we can avoid getting github_ref from our inputs.
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
    skipUpload,
    ...insightsAction.getConfig(),
  };
}

// We need to checkout the HEAD ref because the actions/checkout@v2 action
// checks out the GitHub ref for the pull request, which is pull/<number>/merge.
// This ref points to a merge commit that's on top of the user's actual commits.
// This is important because if you use `git rev-parse HEAD`, you'll get a
// commit SHA that's different than the HEAD SHA. This difference causes issues
// downstream (e.g. when commenting diagram images to PRs).
async function checkoutHeadRef({ githubRef }) {
  const git = simpleGit(".");
  await git.checkout(githubRef);
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

async function getEventData() {
  const githubEventName = process.env.GITHUB_EVENT_NAME;
  let githubEventData = {};

  try {
    githubEventData = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH));
  } catch (e) {
    // No-op, we just return empty githubEventData
  }

  return { githubEventName, githubEventData };
}

async function runPreflight(githubEventName, githubEventData) {
  if (githubEventName === "pull_request") {
    const headRepoFullName = githubEventData.pull_request.head.repo.full_name;
    const baseRepoFullName = githubEventData.pull_request.base.repo.full_name;

    if (headRepoFullName !== baseRepoFullName) {
      core.info(
        `Pull request head repository ${headRepoFullName} differs from base repository ${baseRepoFullName}. Not running.`
      );
      return false;
    }
  }

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

async function runCodeseeMapUpload(config, githubEventName, githubEventData) {
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
    `https://github.com/${config.origin}`,
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

  config.origin = await core.group("Get Repo Origin", getRepoOrigin);

  await core.group("Checkout HEAD Ref", async () => checkoutHeadRef(config))

  const { githubEventName, githubEventData } = await getEventData();
  const passedPreflight = await core.group(
    "Check If Action Should Run",
    async () => runPreflight(githubEventName, githubEventData)
  );
  core.endGroup();

  if (!passedPreflight) {
    return;
  }

  await core.group("Generate Map Data", async () => runCodeseeMap(config));
  if (config.skipUpload) {
    core.info("Skipping map upload");
  } else {
    await core.group("Upload Map to Codesee Server", async () =>
      runCodeseeMapUpload(config, githubEventName, githubEventData)
    );
  }

  if (githubEventName === "pull_request") {
    core.info("Running on a pull request so skipping insight collection");
    return;
  }

  await insightsAction.run(config);
}

main()
  .then(() => {})
  .catch((err) => {
    core.info(`CodeSee Map failed: ${err}
    ${err.stack}`);
  });
