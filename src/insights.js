const core = require("@actions/core");
const exec = require("@actions/exec");

const INSIGHTS = [
  "commitCountLast30Days",
  "lastCommitDate",
  "createDate",
  "linesOfCode",
];

module.exports = {
  run,
  getConfig,
};

function getConfig() {
  return {};
}

async function collectInsight(insightType) {
  const args = [
    "codesee@latest",
    "insight",
    "--insightType",
    insightType,
    "-o",
    `codesee.${insightType}.json`,
  ];
  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function uploadInsight(config, insightType) {
  const args = [
    "codesee@latest",
    "upload",
    "--type",
    "insight",
    "--repo",
    `https://github.com/${config.origin}`,
    "-a",
    config.apiToken,
    `codesee.${insightType}.json`,
  ];

  if (config.insightsServiceUrl) {
    args.push("--url", config.insightsServiceUrl);
  }

  const runExitCode = await exec.exec("npx", args);

  return runExitCode;
}

async function run(config) {
  let exitCode = 0;
  for (const insightType of INSIGHTS) {
    const stepExitCode = await core.group(
      `Collecting ${insightType}`,
      async () => collectInsight(insightType)
    );
    exitCode += stepExitCode;
    if (stepExitCode !== 0) {
      core.error("Generation Step failed with exit code ${stepExitCode}");
    } else if (config.skipUpload) {
      core.info(`Skipping ${insightType} upload`);
    } else {
      exitCode += await core.group(`Uploading ${insightType}`, async () =>
        uploadInsight(config, insightType)
      );
    }
  }

  return exitCode;
}
