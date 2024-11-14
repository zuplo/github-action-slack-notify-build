# Slack Notify Build

Forked from [zuplo/github-action-slack-notify-build](https://github.com/zuplo/github-action-slack-notify-build).

A GitHub Action that sends deployment status notifications to Slack. Will integrate with GitHub and Linear to show
relevant PR and ticket information.

## Inputs

- `channel_id` (required): The Slack channel ID where notifications will be sent
- `status` (required): Current status of the build/deployment
- `environment` (required): Target deployment environment
- `service_name` (required): Name of the service being deployed
- `default_branch_name` (required): Name of the repository's default branch
- `color` (required): Color of the Slack message attachment (default: "#cccccc")
- `message_id` (optional): ID of an existing Slack message to update instead of creating new message.

## Environment Variables

- `LINEAR_API_KEY` (required): The API key to connect to Linear for getting ticket information.
- `GITHUB_TOKEN` (required): The token to connect to GitHub for getting ticket information.
- `SLACK_BOT_TOKEN` (required): The token to connect to Slack for posting/updating messages.

## Outputs

- `message_id`: Identifier of the sent Slack message. Can be used later in the workflow to update the message with the completion status.

## Usage

```yaml
steps:
  - name: Send Slack Notification
    uses: BiblioNexusStudio/github-action-slack-notify-build@main
    with:
      channel_id: "CHANNEL_ID"
      status: "SUCCESS"
      environment: "prod"
      service_name: "aquifer-api"
      default_branch_name: "main"
      color: "#36a64f"
```
