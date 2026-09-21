import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { launchDesktopClient } from "../dist/launcher/index.js";

export default function registerAppCommand(pi: ExtensionAPI): void {
  pi.registerCommand("app", {
    description: "Launch the Pi App desktop client",
    handler: async (_args, ctx) => {
      launchDesktopClient({ cwd: ctx.cwd });
    },
  });
}
