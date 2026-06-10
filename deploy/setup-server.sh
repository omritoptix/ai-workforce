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

# config (must come before auth so setup-token writes into the cloned dir)
git clone https://github.com/omritoptix/claude-config.git ~/.claude

# auth (interactive)
gh auth login
claude setup-token   # authenticates Claude Code against the Max subscription

# code
git clone https://github.com/omritoptix/ai-workforce.git ~/ai-workforce
cd ~/ai-workforce && npm install
cp config.example.json config.json   # then edit: repos, workDir=/home/workforce/work, slackChannel
mkdir -p /home/workforce/work

echo "Now create /home/workforce/workforce.env with SLACK_BOT_TOKEN and SLACK_APP_TOKEN,"
echo "then: sudo cp deploy/workforce.service /etc/systemd/system/ && sudo systemctl enable --now workforce"
