const core = require("@actions/core");
const exec = require("@actions/exec");

module.exports = {
  run,
  getConfig,
};

function getConfig() {
  return {};
}
async function run(config) {
  core.info("Would collect insights data");
}
