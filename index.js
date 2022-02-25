const fs = require('fs');
const os = require('os');
const yaml = require('js-yaml');
const core = require('@actions/core');

const {Octokit} = require("@octokit/rest");
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");
const _Octokit = Octokit.plugin(retry, throttling);

const groups = core.getInput('groups', {required: true, trimWhitespace: true}).split('\n');
console.log(groups);
const org = core.getInput('org', {required: true, trimWhitespace: true});
const repo = core.getInput('repo', {required: true, trimWhitespace: true});
const token = core.getInput('token', {required: true, trimWhitespace: true});

const client = new _Octokit({
    auth: token,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`)
            if (options.request.retryCount <= 1) {
                octokit.log.info(`Retrying after ${retryAfter} seconds!`)
                return true
            }
        },
        onAbuseLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`)
        },
    }
});

(async function () {
    try {
        for (const group of groups) {
            core.info(`Processing group ${group}`)
            const files = await retrieveFiles(group)
            if (Array.isArray(files)) {
                for (const _file of files) {
                    const file = await retrieveFile(_file.path)
                    await processVariables(file)
                }
            } else {
                await processVariables(files)
            }
        }
    } catch (error) {
        core.setFailed(`Failed processing files: ${error.message}`)
        process.exit(1)
    }
})()

async function retrieveFiles(group) {
    try {
        core.info(`Retrieving files for group ${group}`)
        const {data: files} = await client.repos.getContent({
            owner: org,
            repo: repo,
            path: group
        })
        return files
    } catch (err) {
        core.setFailed(`Fail to retrieve files ${group}: ${err.message}`)
        process.exit(1)
    }
}

async function retrieveFile(path) {
    try {
        core.info(`Retrieving file ${path}`)
        const {data: file} = await client.repos.getContent({
            owner: org,
            repo: repo,
            path: path
        })
        return Buffer.from(file.content, 'base64').toString('utf8')
    } catch (err) {
        core.setFailed(`Fail to retrieve file ${path}: ${err.message}`)
        process.exit(1)
    }
}

async function processVariables(file) {
    try {
        core.info(`Processing variables for file ${file.path}`)
        const content = Buffer.from(file.content, 'base64').toString('utf8')
        core.info(`Converting variables to JSON for file ${file.path}`)
        const group = yaml.load(content, "utf8")
        for (const variable of group.variables) {
            core.info(`Appending variable ${variable.name} to environment`)
            await fs.appendFileSync(process.env.GITHUB_ENV, `${variable.name}=${variable.value}${os.EOL}`)
        }
    } catch (err) {
        core.setFailed(`Failed to process variables: ${err.message}`)
        process.exit(1)
    }
}
