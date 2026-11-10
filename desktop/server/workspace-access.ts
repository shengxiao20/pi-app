export class WorkspaceConflict extends Error {}

/** Prevents a workspace replacement from overlapping workspace-scoped requests. */
export class WorkspaceAccess {
  #readers = 0;
  #changing = false;

  assertCanChange(): void {
    if (this.#changing || this.#readers > 0) {
      throw new WorkspaceConflict(
        "Finish current workspace operations before changing workspace.",
      );
    }
  }

  async read<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#changing) {
      throw new WorkspaceConflict(
        "The workspace is changing. Wait for it to finish.",
      );
    }
    this.#readers += 1;
    try {
      return await operation();
    } finally {
      this.#readers -= 1;
    }
  }

  async change<T>(operation: () => Promise<T>): Promise<T> {
    this.assertCanChange();
    this.#changing = true;
    try {
      return await operation();
    } finally {
      this.#changing = false;
    }
  }
}
