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

function isPullRequestEvent(githubEventName) {
  // We currently listen for "pull_request_target" since that will allow secrets
  // to be passed in for forked repos, but we used to listen for "pull_request",
  // so we keep it here for backwards compatibility.
  return (
    githubEventName === "pull_request" ||
    githubEventName === "pull_request_target"
  );
}

function isForkedPullRequestEvent(githubEventName, githubEventData) {
  return (
    isPullRequestEvent(githubEventName) &&
    githubEventData.pull_request.head.repo.fork
  );
}

async function needsInsights(config) {
  const args = [
    "codesee",
    "metadata",
    "--repo",
    `https://github.com/${config.origin}`,
    "-a",
    config.apiToken,
    "-o",
    "codesee.metadata.json",
  ];

  const runExitCode = await exec.exec("npx", args);
  if (runExitCode !== 0) {
    // If we can't get the metadata, assume that we need insights!
    return true;
  }

  try {
    const output = JSON.parse(
      await fs.promises.readFile("codesee.metadata.json", "utf-8")
    );
    return output.insights.length === 0;
  } catch (e) {
    core.warning(
      `\n\n Unable to read metadata for repo, assuming we need insights: ${e.message}`
    );
    return true;
  }
}

function getConfig() {
  let apiToken;
  try {
    apiToken = core.getInput("api_token", { required: true });
  } catch (error) {
    core.warning(
      "\n\n===============================\nError accessing your API Token.\nPlease make sure the CODESEE_ARCH_DIAG_API_TOKEN is set correctly in your *repository* secrets (not environment secrets).\nIf you need a new API Token, please go to app.codesee.io/maps and create a new map.\nThis will generate a new token for you.\n===============================\n\n"
    );
    throw error;
  }
  const webpackConfigPath = core.getInput("webpack_config_path", {
    required: false,
  });
  const supportTypescript = core.getBooleanInput("support_typescript", {
    required: false,
  });
  const skipUpload = core.getBooleanInput("skip_upload", {
    required: false,
  });

  // The origin is in the format of "<owner>/<repo>". This environment variable
  // seems to have the correct value for both branch PRs and fork PRs (this
  // needs to be the base repo, not the fork repo).
  const origin = process.env.GITHUB_REPOSITORY;

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
    origin,
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

async function runCodeseeMap(config, excludeLangs) {
  const args = ["codesee", "map", "-o", "codesee.map.json"];
  if (excludeLangs) {
    args.push("-x", excludeLangs.join(","));
  }

  if (config.webpackConfigPath) {
    args.push("-w", config.webpackConfigPath);
  }
  if (config.supportTypescript) {
    args.push("--typescript");
  }
  args.push(process.cwd());
  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function runCodeseeMapUpload(config, githubEventName, githubEventData) {
  const additionalArguments = config.githubRef ? ["-f", config.githubRef] : [];

  if (isPullRequestEvent(githubEventName)) {
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

  await core.group("Checkout HEAD Ref", async () => checkoutHeadRef(config));

  const { githubEventName, githubEventData } = await getEventData();
  core.endGroup();

  await core.group("Generate Map Data", async () => {
    const excludeLangs = [];
    if (isForkedPullRequestEvent(githubEventName, githubEventData)) {
      core.info("Detected Forked PR, disabling python");
      excludeLangs.push("python");
    }
    return await runCodeseeMap(config, excludeLangs);
  });
  if (config.skipUpload) {
    core.info("Skipping map upload");
  } else {
    await core.group("Upload Map to Codesee Server", async () =>
      runCodeseeMapUpload(config, githubEventName, githubEventData)
    );
  }

  if (isPullRequestEvent(githubEventName) && !(await needsInsights(config))) {
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
