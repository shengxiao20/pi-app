export const PI_NOTIFICATION_EVENT = "pi.notification";

export type PiNotification = {
  message: string;
  level: "info" | "warning" | "error";
};

export function parsePiNotification(value: unknown): PiNotification {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Pi notification.");
  }
  const { message, level } = value as Record<string, unknown>;
  if (
    typeof message !== "string" ||
    (level !== "info" && level !== "warning" && level !== "error")
  ) {
    throw new Error("Invalid Pi notification.");
  }
  return { message, level };
}
