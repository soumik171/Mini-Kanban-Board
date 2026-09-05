// Typed client for the Mini Kanban Express API.
//
// Session model: the backend stores a refresh token in an HttpOnly cookie
// (path /api/auth) and returns short-lived access tokens from
// POST /api/auth/refresh. We keep the access token in memory only and
// transparently refresh it when a request comes back 401.
//
// Requests are same-origin in development (Next rewrites /api to the
// backend), so the cookie travels automatically with credentials: "include".

export interface User {
  id: string;
  email: string;
  name: string;
}

export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

export interface BoardSummary {
  id: string;
  title: string;
  description: string | null;
  owner: User;
  createdAt: string;
  updatedAt: string;
}

export interface ListedBoard extends BoardSummary {
  role: BoardRole;
}

export interface BoardDetail {
  board: BoardSummary;
  role: BoardRole;
}

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  position: number;
  priority: Priority;
  dueDate: string | null;
  labels: string[];
  assignee: User | null;
  columnId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  title: string;
  position: number;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface CommentItem {
  id: string;
  content: string;
  taskId: string;
  author: User;
  createdAt: string;
}

export interface Member {
  user: User;
  role: BoardRole;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: User;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The access token lives only in memory: it is never persisted, so a refresh
// cookie alone cannot be stolen from localStorage.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * URL for a board's realtime SSE stream. EventSource cannot set an
 * Authorization header, so the stream authenticates with the refresh cookie,
 * which is path-scoped to /api/auth - hence the endpoint lives there.
 */
export function eventStreamUrl(boardId: string): string {
  return `${API_BASE}/api/auth/stream?boardId=${encodeURIComponent(boardId)}`;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (auth && accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.ok) {
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  const data = (await readBody(res)) as ErrorBody;
  const code = data?.error?.code ?? "REQUEST_FAILED";
  const message = data?.error?.message ?? `Request failed with status ${res.status}`;

  // One transparent refresh attempt: if the access token expired (15 min),
  // trade the refresh cookie for a fresh pair and retry the original request.
  if (res.status === 401 && auth && path !== "/api/auth/refresh") {
    if (await refreshSession()) {
      return request<T>(path, { ...options, auth: true });
    }
  }

  throw new ApiError(res.status, code, message);
}

export async function refreshSession(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    setAccessToken(null);
    return false;
  }
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) {
    setAccessToken(null);
    return false;
  }
  setAccessToken(body.accessToken);
  return true;
}

// ---------------------------------------------------------------- auth ---

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { user } = await request<{ user: User }>("/api/auth/me");
    return user;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const { user } = await request<{ user: User }>("/api/auth/login", {
    method: "POST",
    auth: false,
    body: { email, password },
  });
  const ok = await refreshSession();
  if (!ok) {
    throw new ApiError(401, "UNAUTHORIZED", "Could not start a session");
  }
  return user;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const { user } = await request<{ user: User }>("/api/auth/register", {
    method: "POST",
    auth: false,
    body: { name, email, password },
  });
  const ok = await refreshSession();
  if (!ok) {
    throw new ApiError(401, "UNAUTHORIZED", "Could not start a session");
  }
  return user;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/api/auth/logout", { method: "POST", auth: false });
  } finally {
    setAccessToken(null);
  }
}

// --------------------------------------------------------------- boards ---

export async function listBoards(): Promise<ListedBoard[]> {
  const { boards } = await request<{ boards: ListedBoard[] }>("/api/boards");
  return boards;
}

export async function createBoard(title: string, description?: string): Promise<BoardSummary> {
  const { board } = await request<{ board: BoardSummary }>("/api/boards", {
    method: "POST",
    body: { title, description: description || null },
  });
  return board;
}

export async function getBoard(boardId: string): Promise<BoardDetail> {
  return request<BoardDetail>(`/api/boards/${boardId}`);
}

export async function updateBoard(
  boardId: string,
  patch: { title?: string; description?: string | null },
): Promise<BoardSummary> {
  const { board } = await request<{ board: BoardSummary }>(`/api/boards/${boardId}`, {
    method: "PATCH",
    body: patch,
  });
  return board;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await request<void>(`/api/boards/${boardId}`, { method: "DELETE" });
}

// -------------------------------------------------------------- columns ---

export async function listColumns(boardId: string): Promise<Column[]> {
  const { columns } = await request<{ columns: Column[] }>(`/api/boards/${boardId}/columns`);
  return columns;
}

export async function createColumn(boardId: string, title: string): Promise<Column> {
  const { column } = await request<{ column: Column }>(`/api/boards/${boardId}/columns`, {
    method: "POST",
    body: { title },
  });
  return column;
}

export async function renameColumn(boardId: string, columnId: string, title: string): Promise<void> {
  await request(`/api/boards/${boardId}/columns/${columnId}`, {
    method: "PATCH",
    body: { title },
  });
}

export async function deleteColumn(boardId: string, columnId: string): Promise<void> {
  await request<void>(`/api/boards/${boardId}/columns/${columnId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------- tasks ---

export interface NewTask {
  title: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  labels?: string[];
  assigneeId?: string | null;
}

export async function createTask(
  boardId: string,
  columnId: string,
  input: NewTask,
): Promise<Task> {
  const { task } = await request<{ task: Task }>(
    `/api/boards/${boardId}/columns/${columnId}/tasks`,
    {
      method: "POST",
      body: input,
    },
  );
  return task;
}

export async function getTask(boardId: string, taskId: string): Promise<Task> {
  const { task } = await request<{ task: Task }>(`/api/boards/${boardId}/tasks/${taskId}`);
  return task;
}

export async function updateTask(
  boardId: string,
  taskId: string,
  patch: Partial<NewTask>,
): Promise<Task> {
  const { task } = await request<{ task: Task }>(`/api/boards/${boardId}/tasks/${taskId}`, {
    method: "PATCH",
    body: patch,
  });
  return task;
}

export async function moveTask(
  boardId: string,
  taskId: string,
  target: { columnId: string; beforeTaskId?: string | null },
): Promise<Task> {
  const { task } = await request<{ task: Task }>(
    `/api/boards/${boardId}/tasks/${taskId}/move`,
    {
      method: "PATCH",
      body: target,
    },
  );
  return task;
}

export async function deleteTask(boardId: string, taskId: string): Promise<void> {
  await request<void>(`/api/boards/${boardId}/tasks/${taskId}`, { method: "DELETE" });
}

// ------------------------------------------------------------- comments ---

export async function listComments(boardId: string, taskId: string): Promise<CommentItem[]> {
  const { comments } = await request<{ comments: CommentItem[] }>(
    `/api/boards/${boardId}/tasks/${taskId}/comments`,
  );
  return comments;
}

export async function addComment(
  boardId: string,
  taskId: string,
  content: string,
): Promise<CommentItem> {
  const { comment } = await request<{ comment: CommentItem }>(
    `/api/boards/${boardId}/tasks/${taskId}/comments`,
    {
      method: "POST",
      body: { content },
    },
  );
  return comment;
}

export async function deleteComment(
  boardId: string,
  taskId: string,
  commentId: string,
): Promise<void> {
  await request<void>(`/api/boards/${boardId}/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------- members ---

export async function listMembers(boardId: string): Promise<Member[]> {
  const { members } = await request<{ members: Member[] }>(`/api/boards/${boardId}/members`);
  return members;
}

export async function addMember(
  boardId: string,
  email: string,
  role: Exclude<BoardRole, "OWNER">,
): Promise<Member> {
  const { member } = await request<{ member: Member }>(`/api/boards/${boardId}/members`, {
    method: "POST",
    body: { email, role },
  });
  return member;
}

export async function changeMemberRole(
  boardId: string,
  userId: string,
  role: Exclude<BoardRole, "OWNER">,
): Promise<Member> {
  const { member } = await request<{ member: Member }>(
    `/api/boards/${boardId}/members/${userId}`,
    {
      method: "PATCH",
      body: { role },
    },
  );
  return member;
}

export async function removeMember(boardId: string, userId: string): Promise<void> {
  await request<void>(`/api/boards/${boardId}/members/${userId}`, { method: "DELETE" });
}

// -------------------------------------------------------------- activity ---

export interface ActivityPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

export async function getActivity(
  boardId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) {
    params.set("limit", String(opts.limit));
  }
  if (opts.cursor) {
    params.set("cursor", opts.cursor);
  }
  const query = params.toString();
  return request<ActivityPage>(`/api/boards/${boardId}/activity${query ? `?${query}` : ""}`);
}
