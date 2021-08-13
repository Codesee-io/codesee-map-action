const core = require("@actions/core");
const exec = require("@actions/exec");

const INSIGHTS = ["lastCommitDate", "commitCountLast30Days", "createDate"];

module.exports = {
  run,
  getConfig,
};

function getConfig() {
  return {};
}

async function collectInsight(config, insightType) {
  const args = [
    "codesee",
    "insight",
    "--insightType",
    insightType,
    "--repo",
    `https://github.com/${origin}`,
    "-a",
    config.apiToken,
    `codesee.${insightType}.json`,
  ];
  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function uploadInsight(config, insightType) {
  const args = [
    "codesee",
    "upload",
    "--type",
    "insight",
    "--repo",
    `https://github.com/${origin}`,
    "-a",
    config.apiToken,
    `codesee.${insightType}.json`,
  ];

  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function run(config) {
  let exitCode = 0;
  for (const insightType of INSIGHTS) {
    exitCode += core.group(`Collecting ${insightType}`, () =>
      collectInsight(config, insightType)
    );
    if (config.skipUpload) {
      core.info(`Skipping ${insightType} upload`);
    } else {
      exitCode += core.group(`Uploading ${insightType}`, () =>
        uploadInsight(config, insightType)
      );
    }
  }

  return exitCode;
}
