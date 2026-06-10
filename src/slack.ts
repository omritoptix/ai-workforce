import { App } from "@slack/bolt";

export interface IncomingMessage {
  thread_ts?: string;
  bot_id?: string;
  text?: string;
}

export class ThreadRouter {
  private threadToIssue = new Map<string, string>();
  onReply: (issueKey: string, text: string) => void = () => {};

  register(threadTs: string, issueKey: string): void {
    this.threadToIssue.set(threadTs, issueKey);
  }

  handle(m: IncomingMessage): void {
    if (!m.thread_ts || m.bot_id || !m.text) return;
    const key = this.threadToIssue.get(m.thread_ts);
    if (key) this.onReply(key, m.text);
  }
}

export class SlackBridge {
  readonly router = new ThreadRouter();
  private app: App;

  constructor(private channel: string) {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
    });
    this.app.message(async ({ message }) => this.router.handle(message as IncomingMessage));
  }

  async post(text: string, threadTs?: string): Promise<string> {
    const res = await this.app.client.chat.postMessage({
      channel: this.channel,
      text,
      thread_ts: threadTs,
    });
    return res.ts as string;
  }

  async start(): Promise<void> {
    await this.app.start();
  }
}
