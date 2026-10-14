import type { DatabaseSync } from "node:sqlite";
import type { AdapterKind, ChatMessage } from "../providers/types.ts";

export type NodeKind = "prompt" | "answer" | "run" | "error";

export interface Transcript {
  adapter: AdapterKind;
  messages: ChatMessage[];
}

export interface NodeRecord {
  id: number;
  parentId: number | null;
  chatId: number;
  userId: number;
  kind: NodeKind;
  text: string;
  provider: string | null;
  model: string | null;
  transcript: Transcript | null;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
  sandboxRuns: number;
  costUsd: number | null;
  day: string;
  createdAt: number;
}

export type NewNode = Pick<NodeRecord, "parentId" | "chatId" | "userId" | "kind" | "text" | "day"> &
  Partial<
    Pick<
      NodeRecord,
      | "provider"
      | "model"
      | "transcript"
      | "inputTokens"
      | "cacheReadTokens"
      | "cacheWriteTokens"
      | "outputTokens"
      | "webSearches"
      | "sandboxRuns"
      | "costUsd"
    >
  >;

export interface PendingRecord {
  id: string;
  chatId: number;
  userId: number;
  nodeId: number;
  messageId: number;
  threadId: number | null;
  createdAt: number;
}

export interface DailyUsage {
  webSearches: number;
  sandboxRuns: number;
}

interface NodeRow {
  id: number;
  parent_id: number | null;
  chat_id: number;
  user_id: number;
  kind: NodeKind;
  text: string;
  provider: string | null;
  model: string | null;
  transcript: string | null;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  web_searches: number;
  sandbox_runs: number;
  cost_usd: number | null;
  day: string;
  created_at: number;
}

function toNode(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    chatId: row.chat_id,
    userId: row.user_id,
    kind: row.kind,
    text: row.text,
    provider: row.provider,
    model: row.model,
    transcript: row.transcript === null ? null : (JSON.parse(row.transcript) as Transcript),
    inputTokens: row.input_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    outputTokens: row.output_tokens,
    webSearches: row.web_searches,
    sandboxRuns: row.sandbox_runs,
    costUsd: row.cost_usd,
    day: row.day,
    createdAt: row.created_at,
  };
}

export class Repo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insertNode(node: NewNode): number {
    const result = this.db
      .prepare(
        `INSERT INTO nodes (parent_id, chat_id, user_id, kind, text, provider, model, transcript,
           input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, web_searches,
           sandbox_runs, cost_usd, day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.parentId,
        node.chatId,
        node.userId,
        node.kind,
        node.text,
        node.provider ?? null,
        node.model ?? null,
        node.transcript === undefined || node.transcript === null
          ? null
          : JSON.stringify(node.transcript),
        node.inputTokens ?? 0,
        node.cacheReadTokens ?? 0,
        node.cacheWriteTokens ?? 0,
        node.outputTokens ?? 0,
        node.webSearches ?? 0,
        node.sandboxRuns ?? 0,
        node.costUsd ?? null,
        node.day,
        Date.now(),
      );
    return Number(result.lastInsertRowid);
  }

  setNodeModel(id: number, provider: string, model: string): void {
    this.db
      .prepare("UPDATE nodes SET provider = ?, model = ? WHERE id = ?")
      .run(provider, model, id);
  }

  node(id: number): NodeRecord | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
    return row === undefined ? undefined : toNode(row);
  }

  linkMessages(chatId: number, messageIds: readonly number[], nodeId: number): void {
    const statement = this.db.prepare(
      "INSERT OR REPLACE INTO tg_messages (chat_id, message_id, node_id) VALUES (?, ?, ?)",
    );
    for (const messageId of messageIds) statement.run(chatId, messageId, nodeId);
  }

  nodeByMessage(chatId: number, messageId: number): NodeRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT nodes.* FROM tg_messages JOIN nodes ON nodes.id = tg_messages.node_id
         WHERE tg_messages.chat_id = ? AND tg_messages.message_id = ?`,
      )
      .get(chatId, messageId) as NodeRow | undefined;
    return row === undefined ? undefined : toNode(row);
  }

  chain(nodeId: number, maxNodes: number): NodeRecord[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE ancestors(id, depth) AS (
           SELECT ?, 0
           UNION ALL
           SELECT nodes.parent_id, ancestors.depth + 1 FROM nodes
           JOIN ancestors ON nodes.id = ancestors.id
           WHERE nodes.parent_id IS NOT NULL AND ancestors.depth + 1 < ?
         )
         SELECT nodes.* FROM ancestors JOIN nodes ON nodes.id = ancestors.id
         ORDER BY ancestors.depth DESC`,
      )
      .all(nodeId, maxNodes) as unknown as NodeRow[];
    return rows.map(toNode);
  }

  dailyUsage(userId: number, day: string): DailyUsage {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(web_searches), 0) AS web, COALESCE(SUM(sandbox_runs), 0) AS runs
         FROM nodes WHERE user_id = ? AND day = ?`,
      )
      .get(userId, day) as { web: number; runs: number };
    return { webSearches: row.web, sandboxRuns: row.runs };
  }

  spentSince(provider: string, day: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM nodes WHERE provider = ? AND day >= ?",
      )
      .get(provider, day) as { spent: number };
    return row.spent;
  }

  createPending(pending: Omit<PendingRecord, "createdAt">): void {
    this.db
      .prepare(
        `INSERT INTO pending (id, chat_id, user_id, node_id, message_id, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.id,
        pending.chatId,
        pending.userId,
        pending.nodeId,
        pending.messageId,
        pending.threadId,
        Date.now(),
      );
  }

  pending(id: string): PendingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pending WHERE id = ?").get(id) as
      | {
          id: string;
          chat_id: number;
          user_id: number;
          node_id: number;
          message_id: number;
          thread_id: number | null;
          created_at: number;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      nodeId: row.node_id,
      messageId: row.message_id,
      threadId: row.thread_id,
      createdAt: row.created_at,
    };
  }

  deletePending(id: string): boolean {
    return this.db.prepare("DELETE FROM pending WHERE id = ?").run(id).changes > 0;
  }

  deletePendingOlderThan(timestamp: number): void {
    this.db.prepare("DELETE FROM pending WHERE created_at < ?").run(timestamp);
  }

  preference(userId: number): { provider: string; model: string } | undefined {
    return this.db
      .prepare("SELECT provider, model FROM user_prefs WHERE user_id = ?")
      .get(userId) as { provider: string; model: string } | undefined;
  }

  setPreference(userId: number, provider: string, model: string): void {
    this.db
      .prepare(
        `INSERT INTO user_prefs (user_id, provider, model) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET provider = excluded.provider, model = excluded.model`,
      )
      .run(userId, provider, model);
  }
}
