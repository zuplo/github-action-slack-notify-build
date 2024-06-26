const core = require("@actions/core");
const github = require("@actions/github");
const { WebClient } = require("@slack/web-api");
const { LinearClient } = require("@linear/sdk");
const { buildSlackAttachments } = require("./src/utils");

(async () => {
  try {
    const status = core.getInput("status");
    const color = core.getInput("color");
    const messageId = core.getInput("message_id");
    const environment = core.getInput("environment");
    const defaultBranchName = core.getInput("default_branch_name");
    const serviceName = core.getInput("service_name");
    const token = process.env.SLACK_BOT_TOKEN;
    const linearApiKey = process.env.LINEAR_API_KEY;
    const slack = new WebClient(token);
    const linearClient = new LinearClient({ apiKey: linearApiKey });

    const attachments = await buildSlackAttachments({
      status,
      color,
      github: {
        ...github,
        token: process.env.GITHUB_TOKEN,
      },
      linearClient,
      environment,
      defaultBranchName,
      serviceName,
    });
    const channelId = core.getInput("channel_id");

    const apiMethod = Boolean(messageId) ? "update" : "postMessage";

    const args = {
      channel: channelId,
      attachments,
    };

    if (messageId) {
      args.ts = messageId;
    }

    const response = await slack.chat[apiMethod](args);

    core.setOutput("message_id", response.ts);
  } catch (error) {
    core.setFailed(error);
  }
})();
