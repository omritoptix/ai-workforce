import { it, expect, vi } from "vitest";
import { ThreadRouter } from "../src/slack.js";

it("routes thread replies to the registered issue", () => {
  const router = new ThreadRouter();
  const onReply = vi.fn();
  router.onReply = onReply;
  router.register("171.001", "o/r#7");
  router.handle({ thread_ts: "171.001", text: "use the global cache" });
  expect(onReply).toHaveBeenCalledWith("o/r#7", "use the global cache");
});

it("ignores bot messages, top-level messages and unknown threads", () => {
  const router = new ThreadRouter();
  const onReply = vi.fn();
  router.onReply = onReply;
  router.register("171.001", "o/r#7");
  router.handle({ thread_ts: "171.001", text: "x", bot_id: "B1" });
  router.handle({ text: "no thread" });
  router.handle({ thread_ts: "999.999", text: "x" });
  expect(onReply).not.toHaveBeenCalled();
});
