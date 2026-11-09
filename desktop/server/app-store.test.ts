import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "./app-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("AppStore", () => {
  it("persists tags and workspace-scoped assignments atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-app-store-"));
    directories.push(directory);
    const path = join(directory, "state", "pi-app.json");
    const store = await AppStore._open(path);
    const tag = await store.createTag(" Work ");
    await store.assign("/workspace/a", "session-1", tag.id);

    const reopened = await AppStore._open(path);
    expect(reopened.listTags()).toEqual([{ id: 1, name: "Work" }]);
    expect(reopened.assignments("/workspace/a")).toEqual([
      { sessionId: "session-1", tagId: 1 },
    ]);
    expect(reopened.assignments("/workspace/b")).toEqual([]);
    expect(await readdir(join(directory, "state"))).toEqual(["pi-app.json"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      nextTagId: 2,
    });
  });

  it("serializes concurrent writes without losing data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-app-store-"));
    directories.push(directory);
    const path = join(directory, "pi-app.json");
    const store = await AppStore._open(path);

    await Promise.all([store.createTag("One"), store.createTag("Two")]);

    const reopened = await AppStore._open(path);
    expect(reopened.listTags()).toEqual([
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ]);
  });

  it("rejects duplicate names and unknown tag assignments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-app-store-"));
    directories.push(directory);
    const store = await AppStore._open(join(directory, "pi-app.json"));
    await store.createTag("Work");

    await expect(store.createTag("work")).rejects.toThrow("already exists");
    await expect(store.assign("/workspace", "session", 99)).rejects.toThrow(
      "Unknown tag: 99",
    );
  });
});
