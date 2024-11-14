const { context } = require("@actions/github");
const { Octokit } = require("@octokit/rest");

/**
 * Builds Slack message attachments for deployment notifications
 *
 * 1. Fetches current deployment for the environment
 * 2. Gets commits between current and new deployment
 * 3. Retrieves associated pull requests for commits
 * 4. Fetches Linear ticket information from PR branches and descriptions
 * 5. Gets GitHub usernames and full names
 * 6. Groups pull requests and tickets into sets
 * 7. Formats deployment information into Slack attachments
 *
 * @param {Object} params - The parameters object
 * @param {string} params.status - The deployment status
 * @param {string} params.color - The color for the Slack attachment
 * @param {Object} params.github - GitHub context object with token
 * @param {Object} params.linearClient - Linear API client instance
 * @param {string} params.environment - Deployment environment name
 * @param {string} params.defaultBranchName - Default branch name
 * @param {string} params.serviceName - Name of the service being deployed
 * @returns {Promise<Array>} Array of Slack attachment objects containing
 */
async function buildSlackAttachments({
  status,
  color,
  github,
  linearClient,
  environment,
  defaultBranchName,
  serviceName,
}) {
  const { owner, repo } = context.repo;
  const octokit = new Octokit({ auth: github.token });

  const currentDeployment = await getCurrentDeployment(
    octokit,
    owner,
    repo,
    environment,
  );

  const newSha = github.context.sha;
  let commits = [{ sha: newSha }];

  if (currentDeployment) {
    commits = await getCommitsBetween(
      octokit,
      owner,
      repo,
      currentDeployment.sha,
      newSha,
    );
  }

  const prs = await getPRsForCommits(
    octokit,
    owner,
    repo,
    commits,
    linearClient,
    defaultBranchName,
  );

  const usernames = new Set(prs.map((pr) => pr.username));
  const usernamesToNames = await Promise.all(
    Array.from(usernames).map(async (username) => {
      const { data: user } = await octokit.users.getByUsername({
        username,
      });
      return [user.login, user.name];
    }),
  );
  const usernameToNameMap = new Map(usernamesToNames);

  const fields = [
    {
      title: "Service",
      value: serviceName,
      short: true,
    },
    {
      title: "Environment",
      value: calculateEnvironmentName(environment),
      short: true,
    },
    {
      title: "Status",
      value: status,
      short: true,
    },
  ];

  if (prs.length > 0) {
    const prLines = prs.flatMap((pr) => {
      const userFirstName =
        usernameToNameMap.get(pr.username)?.split(" ")?.[0] || pr.username;
      if (pr.linearTickets && pr.linearTickets.length > 0) {
        return pr.linearTickets.map((ticket) => {
          return `• *${ticket.id}* - <${ticket.url} | ${ticket.title}> (<${pr.url} | PR>) (${userFirstName})`;
        });
      } else {
        return `• *No ticket* - <${pr.url} | ${pr.title}> (${userFirstName})`;
      }
    });

    const prGroups = prLines.reduce((acc, line, index) => {
      const groupIndex = Math.floor(index / 8);
      if (!acc[groupIndex]) {
        acc[groupIndex] = [];
      }
      acc[groupIndex].push(line);
      return acc;
    }, []);

    prGroups.forEach((group, index) => {
      fields.push({
        title:
          index === 0
            ? "Pull Requests and Linear Tickets"
            : `Pull Requests and Linear Tickets (${index + 1})`,
        value: group.join("\n"),
        short: false,
      });
    });
  } else {
    fields.push({
      title: "Changes",
      value: "No pull requests found for this deployment",
      short: false,
    });
  }

  return [
    {
      color,
      fields,
      footer_icon: "https://github.githubassets.com/favicon.ico",
      footer: `<https://github.com/${owner}/${repo} | ${owner}/${repo}>`,
      ts: Math.floor(Date.now() / 1000),
    },
  ];
}

async function getLinearTicketInfo(linearClient, branch) {
  const ticketIdMatch = branch.match(/^([a-zA-Z]+-\d+)/);
  if (!ticketIdMatch) {
    return null;
  }

  const ticketId = ticketIdMatch[1];
  try {
    const issue = await linearClient.issue(ticketId);
    return {
      id: issue.identifier,
      url: issue.url,
      title: issue.title,
    };
  } catch (error) {
    console.error(`Error fetching Linear ticket: ${error.message}`);
    return null;
  }
}

async function getCurrentDeployment(octokit, owner, repo, environment) {
  try {
    const { data: deployments } = await octokit.repos.listDeployments({
      owner,
      repo,
      environment,
      per_page: 100,
    });

    const successfulDeployments = [];

    // make this work even if there were reruns of the deployment
    for (const deployment of deployments) {
      const { data: statuses } = await octokit.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deployment.id,
        per_page: 10,
      });

      if (statuses.some((status) => status.state === "success")) {
        successfulDeployments.push(deployment);
      }
    }

    if (successfulDeployments.length > 0) {
      return successfulDeployments.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];
    }

    return null;
  } catch (error) {
    console.error(`Error fetching current deployment: ${error.message}`);
    return null;
  }
}

async function getCommitsBetween(octokit, owner, repo, base, head) {
  try {
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    return comparison.commits.filter((commit) => commit.parents.length === 1);
  } catch (error) {
    console.error(
      `Error fetching commits between ${base} and ${head}: ${error.message}`,
    );
    return [];
  }
}

async function getPRsForCommits(
  octokit,
  owner,
  repo,
  commits,
  linearClient,
  defaultBranchName,
) {
  const prs = new Set();

  for (const commit of commits) {
    try {
      const { data: pullRequests } =
        await octokit.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commit.sha,
        });

      for (const pr of pullRequests) {
        if (
          pr.base.ref === defaultBranchName ||
          pr.base.ref.match(/^release-(patch|hotfix)-/)
        ) {
          const linearTicketInfos = [];
          const branchTicketInfo = await getLinearTicketInfo(
            linearClient,
            pr.head.ref,
          );
          if (branchTicketInfo) linearTicketInfos.push(branchTicketInfo);

          const titleAndBodyText = `${pr.title} ${pr.body}`;
          const ticketIdMatches =
            titleAndBodyText.match(/[a-zA-Z]+-\d+/g) || [];

          for (const ticketId of ticketIdMatches) {
            const additionalTicketInfo = await getLinearTicketInfo(
              linearClient,
              ticketId,
            );
            if (
              additionalTicketInfo &&
              additionalTicketInfo.id !== branchTicketInfo?.id
            )
              linearTicketInfos.push(additionalTicketInfo);
          }

          let username = pr.user.login;
          const titleIdMatch = pr.title.match(/\(#(\d+)\)$/);
          if (titleIdMatch) {
            const linkedPrNumber = parseInt(titleIdMatch[1], 10);
            try {
              const { data: linkedPr } = await octokit.pulls.get({
                owner,
                repo,
                pull_number: linkedPrNumber,
              });
              username = linkedPr.user.login;
              const linkedPrBranchTicketInfo = await getLinearTicketInfo(
                linearClient,
                linkedPr.head.ref,
              );
              if (
                linkedPrBranchTicketInfo &&
                !linearTicketInfos.some(
                  (ticket) => ticket.id === linkedPrBranchTicketInfo.id,
                )
              ) {
                linearTicketInfos.push(linkedPrBranchTicketInfo);
              }
              const linkedPrTitleAndBodyText = `${pr.title} ${pr.body}`;
              const linkedPrTickets =
                linkedPrTitleAndBodyText.match(/[a-zA-Z]+-\d+/g) || [];
              for (const ticketId of linkedPrTickets) {
                const additionalTicketInfo = await getLinearTicketInfo(
                  linearClient,
                  ticketId,
                );
                if (
                  additionalTicketInfo &&
                  !linearTicketInfos.some(
                    (ticket) => ticket.id === additionalTicketInfo.id,
                  )
                ) {
                  linearTicketInfos.push(additionalTicketInfo);
                }
              }
            } catch (error) {
              console.error(
                `Error fetching linked PR #${linkedPrNumber}: ${error.message}`,
              );
            }
          }

          prs.add({
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            username,
            linearTickets: linearTicketInfos,
          });
        }
      }
    } catch (error) {
      console.error(
        `Error fetching PRs for commit ${commit.sha}: ${error.message}`,
      );
    }
  }

  return Array.from(prs);
}

function calculateEnvironmentName(environment) {
  return environment.toLowerCase().includes("qa")
    ? "QA"
    : environment.toLowerCase().includes("prod")
      ? `:warning: PROD :warning:`
      : environment.toUpperCase();
}

module.exports.buildSlackAttachments = buildSlackAttachments;
