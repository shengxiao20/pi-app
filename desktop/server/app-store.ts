import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type Tag = { id: number; name: string };
export type SessionTagAssignment = {
  sessionId: string;
  tagId: number | null;
};

type StoreData = {
  nextTagId: number;
  tags: Tag[];
  assignments: Record<string, Record<string, number>>;
};

export class AppStore {
  readonly #path: string;
  #data: StoreData;
  #saveQueue: Promise<void> = Promise.resolve();

  private constructor(path: string, data: StoreData) {
    this.#path = path;
    this.#data = data;
  }

  static async _open(
    path = join(homedir(), ".pi", "agent", "pi-app.json"),
  ): Promise<AppStore> {
    await mkdir(dirname(path), { recursive: true });
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as StoreData;
      return new AppStore(path, data);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
      const store = new AppStore(path, {
        nextTagId: 1,
        tags: [],
        assignments: {},
      });
      await store.#save();
      return store;
    }
  }

  listTags(): Tag[] {
    return [...this.#data.tags].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createTag(name: string): Promise<Tag> {
    const normalized = this.#normalizedName(name);
    this.#assertUniqueName(normalized);
    const tag = { id: this.#data.nextTagId++, name: normalized };
    this.#data.tags.push(tag);
    await this.#save();
    return tag;
  }

  async renameTag(id: number, name: string): Promise<Tag> {
    const normalized = this.#normalizedName(name);
    this.#assertUniqueName(normalized, id);
    const tag = this.#data.tags.find((item) => item.id === id);
    if (!tag) throw new Error(`Unknown tag: ${id}`);
    tag.name = normalized;
    await this.#save();
    return tag;
  }

  async deleteTag(id: number): Promise<void> {
    if (!this.#data.tags.some((tag) => tag.id === id)) {
      throw new Error(`Unknown tag: ${id}`);
    }
    this.#data.tags = this.#data.tags.filter((tag) => tag.id !== id);
    for (const assignments of Object.values(this.#data.assignments)) {
      for (const [sessionId, tagId] of Object.entries(assignments)) {
        if (tagId === id) delete assignments[sessionId];
      }
    }
    await this.#save();
  }

  assignments(workspace: string): SessionTagAssignment[] {
    return Object.entries(this.#data.assignments[workspace] ?? {}).map(
      ([sessionId, tagId]) => ({ sessionId, tagId }),
    );
  }

  async assign(
    workspace: string,
    sessionId: string,
    tagId: number | null,
  ): Promise<void> {
    const assignments = (this.#data.assignments[workspace] ??= {});
    if (tagId === null) {
      delete assignments[sessionId];
    } else {
      if (!this.#data.tags.some((tag) => tag.id === tagId)) {
        throw new Error(`Unknown tag: ${tagId}`);
      }
      assignments[sessionId] = tagId;
    }
    await this.#save();
  }

  #normalizedName(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new Error("Tag name cannot be blank.");
    return normalized;
  }

  #assertUniqueName(name: string, exceptId?: number): void {
    const duplicate = this.#data.tags.some(
      (tag) =>
        tag.id !== exceptId &&
        tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`A tag named “${name}” already exists.`);
  }

  #save(): Promise<void> {
    const content = `${JSON.stringify(this.#data, null, 2)}\n`;
    this.#saveQueue = this.#saveQueue.then(async () => {
      const temporary = `${this.#path}.${process.pid}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, this.#path);
    });
    return this.#saveQueue;
  }
}
