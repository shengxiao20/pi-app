import { describe, expect, it } from "vitest";
import { WorkspaceAccess, WorkspaceConflict } from "./workspace-access.ts";

describe("WorkspaceAccess", () => {
  it("rejects a workspace change while a run-scoped read is active", async () => {
    const access = new WorkspaceAccess();
    let finish!: () => void;
    const read = access.read(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    await expect(access.change(async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceConflict,
    );
    finish();
    await read;
    await expect(access.change(async () => "changed")).resolves.toBe("changed");
  });

  it("rejects reads and concurrent changes while changing workspace", async () => {
    const access = new WorkspaceAccess();
    let finish!: () => void;
    const change = access.change(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    await expect(access.read(async () => undefined)).rejects.toThrow(
      "workspace is changing",
    );
    await expect(access.change(async () => undefined)).rejects.toBeInstanceOf(
      WorkspaceConflict,
    );
    finish();
    await change;
    await expect(access.read(async () => "read")).resolves.toBe("read");
  });

  it("releases access when an operation throws", async () => {
    const access = new WorkspaceAccess();
    await expect(
      access.read(async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    await expect(access.change(async () => "changed")).resolves.toBe("changed");
  });
});
