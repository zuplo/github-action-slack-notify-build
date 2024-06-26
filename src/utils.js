const { context } = require("@actions/github");

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

async function buildSlackAttachments({
  status,
  color,
  github,
  linearClient,
  environment,
}) {
  const { payload, ref, eventName } = github.context;
  const { owner, repo } = context.repo;
  const event = eventName;
  const branch =
    event === "pull_request"
      ? payload.pull_request.head.ref
      : ref.replace("refs/heads/", "");

  const linearTicketInfo = await getLinearTicketInfo(linearClient, branch);

  const sha =
    event === "pull_request"
      ? payload.pull_request.head.sha
      : github.context.sha;

  const referenceLink =
    event === "pull_request"
      ? {
          title: "Pull Request",
          value: `<${payload.pull_request.html_url} | ${payload.pull_request.title}>`,
          short: true,
        }
      : {
          title: "Branch",
          value: `<https://github.com/${owner}/${repo}/commit/${sha} | ${branch}>`,
          short: true,
        };

  const environmentField = {
    title: "Environment",
    value:
      environment.toLowerCase() === "prod"
        ? `:warning: ${environment} :warning:`
        : environment,
    short: true,
  };

  // extract fields into a const
  const fields = [
    {
      title: "Repo",
      value: `<https://github.com/${owner}/${repo} | ${repo}>`,
      short: true,
    },
    {
      title: "Status",
      value: status,
      short: true,
    },
  ];

  if (referenceLink) {
    fields.push(referenceLink);
  }

  fields.push(environmentField);

  if (linearTicketInfo) {
    fields.push({
      title: "Linear Ticket",
      value: `<${linearTicketInfo.url} | ${linearTicketInfo.id}: ${linearTicketInfo.title}>`,
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

module.exports.buildSlackAttachments = buildSlackAttachments;

function formatChannelName(channel) {
  return channel.replace(/[#@]/g, "");
}

module.exports.formatChannelName = formatChannelName;
