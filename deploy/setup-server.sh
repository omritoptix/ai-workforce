#!/usr/bin/env bash
# Run ON the Hetzner server as the dedicated 'workforce' user (one-time bootstrap).
set -euo pipefail

# toolchain
sudo apt-get update
sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
(type -p wget >/dev/null || sudo apt-get install -y wget) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
  && sudo apt-get update && sudo apt-get install -y gh
sudo npm install -g @anthropic-ai/claude-code

# auth (interactive) — gh first: both repos below are private
gh auth login

# config (must come before setup-token, which writes credentials into ~/.claude)
gh repo clone omritoptix/claude-config ~/.claude
claude setup-token   # authenticates Claude Code against the Max subscription

# code
gh repo clone omritoptix/ai-workforce ~/ai-workforce
cd ~/ai-workforce && npm install
cp config.example.json config.json   # then edit: repos, workDir=/home/workforce/work, slackChannel
mkdir -p /home/workforce/work

echo "Now create /home/workforce/workforce.env with SLACK_BOT_TOKEN and SLACK_APP_TOKEN,"
echo "then: sudo cp deploy/workforce.service /etc/systemd/system/ && sudo systemctl enable --now workforce"
