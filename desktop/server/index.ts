import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgUiEventWriter,
  assertCanonicalHistory,
  parseRunInput,
  promptFromInput,
} from "./agui-adapter.ts";
import { AppStore } from "./app-store.ts";
import { saveClipboardImage } from "./clipboard-images.ts";
import { SessionRegistry, workspaceView } from "./session-registry.ts";
import { WorkspaceAccess, WorkspaceConflict } from "./workspace-access.ts";
import { NativeWorkspacePicker } from "./workspace-picker.ts";
import { isPathInside } from "./path-safety.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const initialWorkspace = await realpath(
  process.env.PI_APP_WORKSPACE ?? process.cwd(),
);
const registry = new SessionRegistry(initialWorkspace);
const store = await AppStore._open(process.env.PI_APP_STORE);
const activeRuns = new Map<string, string>();
const workspaceAccess = new WorkspaceAccess();
const workspacePicker = new NativeWorkspacePicker();
const isProduction =
  process.argv.includes("--production") ||
  (process.env.NODE_ENV !== "development" && !process.argv.includes("--dev"));
const vite = isProduction
  ? undefined
  : await (
      await import("vite")
    ).createServer({
      root,
      server: { middlewareMode: true },
    });

const port = Number(process.env.PORT ?? 1420);
const allowedOrigin = `http://127.0.0.1:${port}`;

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      const origin = request.headers.origin;
      if (origin && origin !== allowedOrigin) {
        sendError(response, 403, "Cross-origin API requests are not allowed.");
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/api/health")) {
        await route(request, response);
        return;
      }
      const requestedWorkspace = request.headers["x-pi-app-workspace"];
      if (requestedWorkspace && requestedWorkspace !== registry.cwd) {
        sendError(
          response,
          409,
          "This page belongs to a different workspace. Reload it before continuing.",
        );
        return;
      }
      const operation = () => route(request, response);
      if (isWorkspaceChange(request)) {
        await workspaceAccess.change(operation);
      } else {
        await workspaceAccess.read(operation);
      }
      return;
    }
    if (vite) {
      vite.middlewares(request, response, () => {
        sendError(response, 404, "Page not found.");
      });
      return;
    }
    await serveStatic(request, response);
  } catch (reason) {
    sendError(
      response,
      reason instanceof WorkspaceConflict ? 409 : 500,
      reason instanceof Error ? reason.message : String(reason),
    );
  }
});

const serverPort = port;
server.listen(serverPort, "127.0.0.1", () => {
  console.log(`Pi App: http://127.0.0.1:${serverPort}`);
  console.log(`Workspace: ${registry.cwd}`);
});

async function route(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const segments = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { service: "pi-app", status: "ok" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/clipboard-images") {
    const path = await saveClipboardImage(request);
    sendJson(response, 201, { path });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace") {
    sendJson(response, 200, workspaceView(registry.cwd));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/workspace/select") {
    if (activeRuns.size > 0) {
      sendError(response, 409, "Abort active runs before changing workspace.");
      return;
    }
    const path = await workspacePicker.pick(registry.cwd);
    if (path === null) {
      sendJson(response, 204, undefined);
      return;
    }
    await replaceWorkspace(path, response);
    return;
  }
  if (request.method === "PUT" && url.pathname === "/api/workspace") {
    if (activeRuns.size > 0) {
      sendError(response, 409, "Abort active runs before changing workspace.");
      return;
    }
    const body = await jsonBody(request);
    if (typeof body.path !== "string")
      throw new Error("Workspace path is required.");
    await replaceWorkspace(body.path, response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(response, 200, await registry.list());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    sendJson(response, 201, await registry.create());
    return;
  }
  if (segments[1] === "sessions" && segments[2]) {
    const sessionId = decodeURIComponent(segments[2]);
    if (request.method === "PATCH" && segments.length === 3) {
      const body = await jsonBody(request);
      if (typeof body.name !== "string")
        throw new Error("Session name is required.");
      await registry.rename(sessionId, body.name);
      sendJson(response, 204, undefined);
      return;
    }
    if (request.method === "POST" && segments[3] === "abort") {
      await registry.abort(sessionId);
      sendJson(response, 204, undefined);
      return;
    }
    if (request.method === "GET" && segments[3] === "commands") {
      sendJson(response, 200, await registry.commands(sessionId));
      return;
    }
    if (request.method === "GET" && segments[3] === "history") {
      const before = Number(
        url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER,
      );
      const limit = Number(url.searchParams.get("limit") ?? 80);
      sendJson(response, 200, registry.history(sessionId, before, limit));
      return;
    }
    if (request.method === "GET" && segments[3] === "messages") {
      sendJson(response, 200, registry.canonicalMessages(sessionId));
      return;
    }
  }
  if (request.method === "POST" && url.pathname === "/api/agent") {
    const input = parseRunInput(await jsonValue(request));
    if (activeRuns.has(input.threadId)) {
      sendError(response, 409, "This session already has an active run.");
      return;
    }
    activeRuns.set(input.threadId, input.runId);
    try {
      const canonical = registry.canonicalMessages(input.threadId);
      assertCanonicalHistory(input, canonical);
      const prompt = promptFromInput(input);
      const session = await registry.open(input.threadId);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      const writer = new AgUiEventWriter(response, input);
      const unsubscribe = session.subscribe((event) => writer.accept(event));
      writer.start(input);
      const unsubscribeFeedback = registry.subscribeFeedback(
        input.threadId,
        (event) => writer.acceptFeedback(event),
      );
      try {
        await session.prompt(prompt);
        writer.finish();
      } catch (reason) {
        writer.fail(reason);
      } finally {
        unsubscribeFeedback();
        unsubscribe();
      }
    } finally {
      activeRuns.delete(input.threadId);
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/tags") {
    sendJson(response, 200, store.listTags());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/tags") {
    const body = await jsonBody(request);
    if (typeof body.name !== "string") throw new Error("Tag name is required.");
    sendJson(response, 201, await store.createTag(body.name));
    return;
  }
  if (segments[1] === "tags" && segments[2]) {
    const tagId = Number(segments[2]);
    if (request.method === "PATCH") {
      const body = await jsonBody(request);
      if (typeof body.name !== "string")
        throw new Error("Tag name is required.");
      sendJson(response, 200, await store.renameTag(tagId, body.name));
      return;
    }
    if (request.method === "DELETE") {
      await store.deleteTag(tagId);
      sendJson(response, 204, undefined);
      return;
    }
  }
  if (request.method === "GET" && url.pathname === "/api/session-tags") {
    sendJson(response, 200, store.assignments(registry.cwd));
    return;
  }
  if (
    request.method === "PUT" &&
    segments[1] === "session-tags" &&
    segments[2]
  ) {
    const body = await jsonBody(request);
    const tagId = body.tagId;
    if (tagId !== null && typeof tagId !== "number") {
      throw new Error("tagId must be a number or null.");
    }
    registry.assertKnown(decodeURIComponent(segments[2]));
    await store.assign(registry.cwd, decodeURIComponent(segments[2]), tagId);
    sendJson(response, 204, undefined);
    return;
  }
  sendError(response, 404, "API route not found.");
}

async function replaceWorkspace(
  path: string,
  response: ServerResponse,
): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isDirectory())
    throw new Error("Workspace must be a directory.");
  await registry.replaceWorkspace(path);
  sendJson(response, 200, workspaceView(registry.cwd));
}

function isWorkspaceChange(request: IncomingMessage): boolean {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  return (
    (request.method === "POST" && pathname === "/api/workspace/select") ||
    (request.method === "PUT" && pathname === "/api/workspace")
  );
}

async function jsonValue(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function jsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const value = await jsonValue(request);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (status === 204) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function sendError(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  sendJson(response, status, { message });
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const distRoot = join(root, "dist");
  const path = resolve(distRoot, requested);
  if (!isPathInside(distRoot, path)) {
    sendError(response, 404, "Page not found.");
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": contentType(path) }).end(body);
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
    const body = await readFile(join(root, "dist", "index.html"));
    response
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(body);
  }
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  return types[extname(path)] ?? "application/octet-stream";
}
