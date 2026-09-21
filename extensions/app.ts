import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerAppCommand(pi: ExtensionAPI): void {
  pi.registerCommand("app", {
    description: "Launch the Pi App desktop client",
    handler: async () => {
      throw new Error("Pi App desktop launcher is not implemented yet");
    },
  });
}
