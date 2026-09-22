import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { launchDesktopClient } from "../dist/launcher/index.js";

export default function registerAppCommand(pi: ExtensionAPI): void {
  pi.registerCommand("app", {
    description: "Launch the Pi App desktop client",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile)
        throw new Error("Pi App requires a persisted Pi session");
      launchDesktopClient({ cwd: ctx.cwd, sessionFile });
      ctx.shutdown();
    },
  });
}
