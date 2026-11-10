import { EventSchema } from "@ag-ui/core/schemas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const html = readFileSync(
  join(process.cwd(), "public", "pi-agui-map.html"),
  "utf8",
);

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing event-map element: ${selector}`);
  return element;
}

function selectScenario(name: string): void {
  requiredElement<HTMLButtonElement>(`[data-scenario="${name}"]`).click();
}

function lastStep(): void {
  const steps = document.querySelectorAll<HTMLButtonElement>(
    "#step-controls button",
  );
  steps[steps.length - 1].click();
}

function state(): Record<string, unknown> {
  return JSON.parse(requiredElement("#payload-state").textContent!);
}

describe("offline Pi to AG-UI event map", () => {
  beforeEach(() => {
    const page = new DOMParser().parseFromString(html, "text/html");
    document.body.innerHTML = page.body.innerHTML;
    const script = requiredElement<HTMLScriptElement>("script").textContent;
    if (!script) throw new Error("Missing event-map script.");
    // Execute only the repository-owned inline script against the test DOM.
    new Function("document", script)(document);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("needs no external resources and retains a static mapping without script execution", () => {
    const page = new DOMParser().parseFromString(html, "text/html");
    expect(page.documentElement.lang).toBe("zh-CN");
    expect(
      page.querySelectorAll("script[src], link[href], img[src]"),
    ).toHaveLength(0);
    expect(page.querySelectorAll(".map-row")).toHaveLength(12);
    expect(page.body.textContent).toContain("TOOL_CALL_RESULT");
    expect(page.body.textContent).toContain("不是 agent_start 映射");
    expect(page.body.textContent).toContain("不是 Pi message_end 映射");
    expect(page.body.textContent).toContain("不是专用 AG-UI 事件");
    expect(page.querySelector("noscript")?.textContent).toContain(
      "场景交互需要 JavaScript",
    );
    expect(html).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
  });

  it("opens the text scenario with accessible controls and a sequence diagram", () => {
    expect(requiredElement("#scenario-title").textContent).toContain(
      "普通文字",
    );
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(requiredElement("#sequence").getAttribute("viewBox")).toMatch(
      /^0 0 1120 \d+$/,
    );
    expect(requiredElement("#sequence title").textContent).toContain(
      "普通文字",
    );
    expect(state().rawPrompt).toBe("Summarize the project.");
  });

  it.each([
    "text",
    "tool",
    "skill",
    "command",
    "handled",
    "extensionError",
    "historyError",
    "cancel",
    "image",
  ])(
    "renders every %s step and validates its AG-UI sample payloads",
    (name) => {
      selectScenario(name);
      expect(
        requiredElement(`[data-scenario="${name}"]`).getAttribute(
          "aria-pressed",
        ),
      ).toBe("true");
      const steps = document.querySelectorAll<HTMLButtonElement>(
        "#step-controls button",
      );
      expect(steps.length).toBeGreaterThan(0);
      expect(
        document.querySelectorAll("#sequence [data-sequence-step]"),
      ).toHaveLength(steps.length);
      for (const step of steps) {
        step.click();
        expect(step.getAttribute("aria-current")).toBe("step");
        expect(requiredElement("#payload-diff").textContent).not.toContain(
          "undefined",
        );
        const events = state().lastEvents;
        if (Array.isArray(events)) {
          for (const event of events)
            expect(() => EventSchema.parse(event)).not.toThrow();
        }
      }
    },
  );

  it("shows skill expansion before the normal model flow without a synthetic skill event", () => {
    selectScenario("skill");
    const expansion = [
      ...document.querySelectorAll<HTMLButtonElement>("#step-controls button"),
    ].find((button) => button.textContent?.includes("_expandSkillCommand"));
    expect(expansion).toBeDefined();
    expansion!.click();
    expect(state().rawPrompt).toBe("/skill:review focus on tests");
    expect(state().sdkPrompt).toContain('<skill name="review"');
    expect(state().sdkPrompt).toContain("focus on tests");
    expect(state().modelActivity).toContain("尚未调用");
    expect(
      (state().lastEvents as { type: string }[]).map((event) => event.type),
    ).toEqual(["RUN_STARTED"]);
    expect(requiredElement("#payload-diff").textContent).toContain(
      '- sdkPrompt: "/skill:review focus on tests"',
    );
  });

  it("keeps tool argument completion separate from the result", () => {
    selectScenario("tool");
    const steps = [
      ...document.querySelectorAll<HTMLButtonElement>("#step-controls button"),
    ];
    const start = steps.find((button) =>
      button.textContent?.includes("tool_execution_start"),
    );
    const end = steps.find((button) =>
      button.textContent?.includes("tool_execution_end"),
    );
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    start!.click();
    expect(
      (state().lastEvents as { type: string }[]).map((event) => event.type),
    ).toEqual([
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    end!.click();
    expect(
      (state().lastEvents as { type: string }[]).map((event) => event.type),
    ).toEqual(["TOOL_CALL_RESULT"]);
  });

  it("finishes a notification-only command without ordinary model work", () => {
    selectScenario("command");
    lastStep();
    expect(state().httpStatus).toBe(200);
    expect(state().modelActivity).toContain("普通 user run 未启动");
    expect(state().lastEvents).toEqual([
      expect.objectContaining({
        type: "RUN_FINISHED",
        outcome: { type: "success" },
      }),
    ]);
    expect(
      requiredElement('[data-map="notify"]').getAttribute("data-selected"),
    ).toBe("true");
  });

  it("distinguishes an HTTP history error from an SSE extension failure", () => {
    selectScenario("historyError");
    lastStep();
    expect(state().httpStatus).toBe(500);
    expect(state().lastEvents).toEqual({
      message:
        "The AG-UI message history does not match the authoritative Pi session.",
    });
    selectScenario("extensionError");
    lastStep();
    expect(state().httpStatus).toBe(200);
    expect(state().lastEvents).toEqual([
      expect.objectContaining({ type: "RUN_ERROR" }),
    ]);
  });

  it("shows cancellation through RUN_FINISHED rather than a fabricated abort event", () => {
    selectScenario("cancel");
    lastStep();
    expect(state().lastEvents).toEqual([
      expect.objectContaining({
        type: "RUN_FINISHED",
        outcome: { type: "cancelled" },
      }),
    ]);
    expect(requiredElement("#scenario-note").textContent).toContain(
      "先后不保证",
    );
  });

  it("uploads images through HTTP and inserts a path without starting an agent run", () => {
    selectScenario("image");
    lastStep();
    expect(state().httpStatus).toBe(201);
    expect(state().draft).toBe("Please inspect /tmp/pi-clipboard-<UUID>.png");
    expect(state().lastEvents).toBeNull();
    expect(state().rawPrompt).toBeNull();
  });
});
