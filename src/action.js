const core = require("@actions/core");
const exec = require("@actions/exec");

function setupEnv() {
    core.setSecret('api_token');
}

function getConfig() {
    const apiToken = core.getInput('api_token', { required: true });
    const webpackConfigPath = core.getInput('webpack_config_path', {required: false });
    const supportTypescript = core.getBooleanInput('support_typescript', { required: false });

    return {
        apiToken,
        webpackConfigPath: webpackConfigPath === '__NULL__' ? undefined : webpackConfigPath,
        supportTypescript,
    }
}

async function installCodesee() {
    return await exec.exec("npm", ["install", "codesee"]);
}

async function runCodeseeWithConfig(config) {
    const runExitCode = await exec.exec("node", [
        'node_modules/.bin/codesee',
    ])

    return runExitCode;
}

async function main() {
    core.startGroup('Setup');
    setupEnv();
    const config =  getConfig();
    core.debug('CONFIG: ');
    core.debug(config);

    await core.group('Install codesee-cli', installCodesee);
    core.endGroup();

    await core.group('Generate Map Data', runCodeseeWithConfig(config))
}

main().then(() => {
}).catch(err => {
    core.setFailed(`CodeSee Map failed: ${err}`);    
})
