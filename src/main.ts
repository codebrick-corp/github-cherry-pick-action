import * as core from '@actions/core'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as utils from './utils'
import {Inputs, createPullRequest} from './github-helper'

const CHERRYPICK_EMPTY =
  'The previous cherry-pick is now empty, possibly due to conflict resolution.'

export async function run(): Promise<void> {
  try {
    const inputs: Inputs = {
      token: core.getInput('token'),
      committer: core.getInput('committer'),
      author: core.getInput('author'),
      branch: core.getInput('branch'),
      labels: utils.getInputAsArray('labels'),
      assignees: utils.getInputAsArray('assignees'),
      reviewers: utils.getInputAsArray('reviewers'),
      teamReviewers: utils.getInputAsArray('teamReviewers')
    }

    const octokit = github.getOctokit(inputs.token)
    const context = github.context
    const githubSha: string | undefined = process.env.GITHUB_SHA
    //context.payload.pull_request?.head?.sha
    core.info(`Cherry pick into branch ${inputs.branch} with ${githubSha!}!`)
    if (!githubSha) return

    core.info(`getPRs ${context.repo.owner} ${context.repo.repo} ${githubSha}!`)
    const prs = await octokit.repos.listPullRequestsAssociatedWithCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      commit_sha: githubSha
    })

    core.info(`pr length ${prs.data.length}`)
    const pr =
      prs.data.length > 0 && prs.data.filter(el => el.state === 'closed')[0]
    if (!pr) return

    core.info(`labels ${pr.labels.map(l => l.name)}`)
    const branches = pr.labels.filter(l => l.name!.startsWith('tests/'))
    if (branches.length === 0) return

    inputs.branch = branches[0].name!

    const prBranch = `cherry-pick-${inputs.branch}-${githubSha}`

    // Configure the committer and author
    core.startGroup('Configuring the committer and author')
    const parsedAuthor = utils.parseDisplayNameEmail(inputs.author)
    const parsedCommitter = utils.parseDisplayNameEmail(inputs.committer)
    core.info(
      `Configured git committer as '${parsedCommitter.name} <${parsedCommitter.email}>'`
    )
    await gitExecution(['config', '--global', 'user.name', parsedAuthor.name])
    await gitExecution([
      'config',
      '--global',
      'user.email',
      parsedCommitter.email
    ])
    core.endGroup()

    // Update  branchs
    core.startGroup('Fetch all branchs')
    await gitExecution(['remote', 'update'])
    await gitExecution(['fetch', '--all'])
    core.endGroup()

    // Create branch new branch
    core.startGroup(`Create new branch from ${inputs.branch}`)
    await gitExecution(['checkout', '-b', prBranch, `origin/${inputs.branch}`])
    core.endGroup()

    await gitExecution(['log', '--oneline'])

    // Cherry pick
    core.startGroup('Cherry picking')
    const result = await gitExecution(['cherry-pick', '-x', `${githubSha}`])
    if (result.exitCode !== 0 && !result.stderr.includes(CHERRYPICK_EMPTY)) {
      throw new Error(`Unexpected error: ${result.stderr}`)
    }
    core.endGroup()

    // Push new branch
    core.startGroup('Push new branch to remote')
    await gitExecution(['push', '-u', 'origin', `${prBranch}`])
    core.endGroup()

    // Create pull request
    core.startGroup('Opening pull request')
    await createPullRequest(inputs, prBranch)
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function gitExecution(params: string[]): Promise<GitOutput> {
  const result = new GitOutput()
  const stdout: string[] = []
  const stderr: string[] = []

  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        stdout.push(data.toString())
      },
      stderr: (data: Buffer) => {
        stderr.push(data.toString())
      }
    }
  }

  const gitPath = await io.which('git', true)
  result.exitCode = await exec.exec(gitPath, params, options)
  result.stdout = stdout.join('')
  result.stderr = stderr.join('')

  if (result.exitCode === 0) {
    core.info(result.stdout.trim())
  } else {
    core.info(result.stderr.trim())
  }

  return result
}

class GitOutput {
  stdout = ''
  stderr = ''
  exitCode = 0
}

run()
