import type {
  ExtensionError,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { PiNotification } from "../shared/extension-feedback.ts";

export type ExtensionFeedbackEvent =
  | ({ type: "notification" } & PiNotification)
  | { type: "error"; message: string };

type FeedbackListener = (event: ExtensionFeedbackEvent) => void;

const unsupportedMethods = {
  select: true,
  confirm: true,
  input: true,
  onTerminalInput: true,
  setStatus: true,
  setWorkingMessage: true,
  setWorkingVisible: true,
  setWorkingIndicator: true,
  setHiddenThinkingLabel: true,
  setWidget: true,
  setFooter: true,
  setHeader: true,
  setTitle: true,
  custom: true,
  pasteToEditor: true,
  setEditorText: true,
  getEditorText: true,
  editor: true,
  addAutocompleteProvider: true,
  setEditorComponent: true,
  getEditorComponent: true,
  getAllThemes: true,
  getTheme: true,
  setTheme: true,
  getToolsExpanded: true,
  setToolsExpanded: true,
} satisfies Record<Exclude<keyof ExtensionUIContext, "notify" | "theme">, true>;

function unsupportedUI(method: string): never {
  throw new Error(
    `Extension UI method "${method}" is not supported by Pi App. Use the Pi TUI for interactive extension UI.`,
  );
}

const unsupportedContext = Object.fromEntries(
  Object.keys(unsupportedMethods).map((method) => [
    method,
    () => unsupportedUI(method),
  ]),
) as { [K in keyof typeof unsupportedMethods]: () => never };

/** Preserve startup feedback until the session has an active event stream. */
export class ExtensionFeedback {
  #pending: ExtensionFeedbackEvent[] = [];
  #listener: FeedbackListener | undefined;

  // The SDK spreads UI properties when it wraps dialog methods.
  readonly uiContext: ExtensionUIContext = {
    ...unsupportedContext,
    theme: new Proxy({} as ExtensionUIContext["theme"], {
      get(_target, property) {
        return unsupportedUI(`theme.${String(property)}`);
      },
    }),
    notify: (message, level = "info") => {
      this.#emit({ type: "notification", message, level });
    },
  };

  readonly onError = (error: ExtensionError): void => {
    this.#emit({
      type: "error",
      message: `${error.extensionPath} (${error.event}): ${error.error}`,
    });
  };

  subscribe(listener: FeedbackListener): () => void {
    if (this.#listener) {
      throw new Error("This session already has an extension feedback stream.");
    }
    this.#listener = listener;
    const pending = this.#pending;
    this.#pending = [];
    // Errors before this stream belong to startup or earlier operations,
    // not to the command that is about to run.
    for (const event of pending) {
      listener(
        event.type === "error"
          ? { type: "notification", message: event.message, level: "error" }
          : event,
      );
    }
    return () => {
      this.#listener = undefined;
    };
  }

  #emit(event: ExtensionFeedbackEvent): void {
    if (this.#listener) this.#listener(event);
    else this.#pending.push(event);
  }
}
