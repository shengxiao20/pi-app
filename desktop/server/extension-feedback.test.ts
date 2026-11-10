import { describe, expect, it, vi } from "vitest";
import { ExtensionFeedback } from "./extension-feedback";

const failure = {
  extensionPath: "example.ts",
  event: "command",
  error: "Failed",
};

describe("extension feedback", () => {
  it("forwards notifications with their level and an info default", () => {
    const feedback = new ExtensionFeedback();
    const listener = vi.fn();
    feedback.subscribe(listener);
    feedback.uiContext.notify("Ready");
    feedback.uiContext.notify("Warning", "warning");
    feedback.uiContext.notify("Error", "error");
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { type: "notification", message: "Ready", level: "info" },
      { type: "notification", message: "Warning", level: "warning" },
      { type: "notification", message: "Error", level: "error" },
    ]);
  });

  it("buffers startup feedback and delivers it only once", () => {
    const feedback = new ExtensionFeedback();
    feedback.uiContext.notify("Started");
    feedback.onError(failure);
    const listener = vi.fn();
    const unsubscribe = feedback.subscribe(listener);
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { type: "notification", message: "Started", level: "info" },
      {
        type: "notification",
        message: "example.ts (command): Failed",
        level: "error",
      },
    ]);
    unsubscribe();
    const next = vi.fn();
    feedback.subscribe(next);
    expect(next).not.toHaveBeenCalled();
    feedback.onError(failure);
    expect(next).toHaveBeenCalledWith({
      type: "error",
      message: "example.ts (command): Failed",
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported UI rather than returning an empty result", () => {
    const feedback = new ExtensionFeedback();
    expect(() => feedback.uiContext.select("Choose", ["one"])).toThrow(
      'Extension UI method "select" is not supported',
    );
    expect(() =>
      feedback.uiContext.custom(() => {
        throw new Error("not reached");
      }),
    ).toThrow('"custom" is not supported');
    const wrapped = { ...feedback.uiContext };
    expect(() => wrapped.setWidget("pet", [])).toThrow(
      '"setWidget" is not supported',
    );
    expect(() => wrapped.theme.fg).toThrow('"theme.fg" is not supported');
  });

  it("rejects concurrent feedback subscriptions", () => {
    const feedback = new ExtensionFeedback();
    feedback.subscribe(vi.fn());
    expect(() => feedback.subscribe(vi.fn())).toThrow("already has");
  });
});
