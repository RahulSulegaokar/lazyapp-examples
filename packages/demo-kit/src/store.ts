import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** What the router keeps about one person's demo, besides the example's own state. */
export interface SessionMeta {
  /** LazyApp contact uuid, for tags and consent. */
  readonly contactUuid: string | null;
  /** WhatsApp profile name or username, when LazyApp shares one. */
  readonly displayName: string | null;
  /** Explicit in-chat opt-in to marketing follow-ups (abandoned cart and the like). */
  readonly marketingOptIn: boolean;
  /** Scheduled follow-ups by key. Cancelled when the session ends. */
  readonly followUps: Readonly<Record<string, ScheduledFollowUp>>;
  /** Inbound messages handled in this session. */
  readonly turns: number;
  /** Ids of the last events applied to this session: state changes are applied exactly once. */
  readonly recentEvents: readonly string[];
}

export interface ScheduledFollowUp {
  /** LazyApp scheduled message id (`DELETE /v1/messages/scheduled/{id}`). */
  readonly id: string;
  readonly category: 'utility' | 'marketing';
  readonly sendAt: string;
}

export interface SessionRecord {
  /** Phone (E.164) or business-scoped user id. */
  readonly address: string;
  readonly sessionId: string;
  readonly exampleId: string;
  /** The example's state as stored (validated against the example's schema on load). */
  readonly state: unknown;
  readonly meta: SessionMeta;
  readonly startedAt: Date;
  readonly lastInboundAt: Date;
  readonly updatedAt: Date;
}

export type InboxStatus = 'pending' | 'done' | 'failed';

export interface InboxRecord {
  readonly id: string;
  readonly type: string;
  readonly payload: string;
  readonly status: InboxStatus;
  readonly attempts: number;
  readonly receivedAt: Date;
}

export interface FlowTokenRecord {
  readonly token: string;
  readonly address: string;
  readonly exampleId: string;
  readonly flowKey: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

/** Namespaced JSON key-value storage an example can use for data that outlives one chat (orders, slots…). */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** Entries whose key starts with `prefix`, sorted by key. */
  list<T>(prefix?: string): { readonly key: string; readonly value: T }[];
}

export const EMPTY_META: SessionMeta = {
  contactUuid: null,
  displayName: null,
  marketingOptIn: false,
  followUps: {},
  turns: 0,
  recentEvents: [],
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    address TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    example_id TEXT NOT NULL,
    state TEXT NOT NULL,
    meta TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_inbound_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_last_inbound ON sessions (last_inbound_at);

  CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    received_at INTEGER NOT NULL,
    processed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS inbox_status ON inbox (status, received_at);

  CREATE TABLE IF NOT EXISTS kv (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
  );

  CREATE TABLE IF NOT EXISTS flow_tokens (
    token TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    example_id TEXT NOT NULL,
    flow_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS opt_outs (
    address TEXT PRIMARY KEY,
    opted_out_at INTEGER NOT NULL
  );
`;

interface SessionRow {
  address: string;
  session_id: string;
  example_id: string;
  state: string;
  meta: string;
  started_at: number;
  last_inbound_at: number;
  updated_at: number;
}

/**
 * Durable state on node:sqlite (no native dependency). One file holds sessions,
 * the webhook inbox (dedupe + crash recovery), example key-value data, flow
 * tokens and opt-outs. Pass `:memory:` in tests.
 */
export class DemoStore {
  private readonly db: DatabaseSync;
  private open = true;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    if (this.open) {
      this.open = false;
      this.db.close();
    }
  }

  // --- Sessions ---------------------------------------------------------------

  getSession(address: string): SessionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE address = ?').get(address) as
      SessionRow | undefined;
    return row === undefined ? undefined : toSession(row);
  }

  saveSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (address, session_id, example_id, state, meta, started_at, last_inbound_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (address) DO UPDATE SET
           session_id = excluded.session_id, example_id = excluded.example_id, state = excluded.state,
           meta = excluded.meta, started_at = excluded.started_at, last_inbound_at = excluded.last_inbound_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        session.address,
        session.sessionId,
        session.exampleId,
        JSON.stringify(session.state ?? null),
        JSON.stringify(session.meta),
        session.startedAt.getTime(),
        session.lastInboundAt.getTime(),
        session.updatedAt.getTime(),
      );
  }

  deleteSession(address: string): void {
    this.db.prepare('DELETE FROM sessions WHERE address = ?').run(address);
    this.db.prepare('DELETE FROM flow_tokens WHERE address = ?').run(address);
  }

  /** Sessions whose last inbound message is older than `before`. */
  idleSessions(before: Date): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE last_inbound_at < ? ORDER BY last_inbound_at LIMIT 500')
      .all(before.getTime()) as unknown as SessionRow[];
    return rows.map(toSession);
  }

  countSessions(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    return row.n;
  }

  // --- Opt-outs ---------------------------------------------------------------

  isOptedOut(address: string): boolean {
    return this.db.prepare('SELECT 1 FROM opt_outs WHERE address = ?').get(address) !== undefined;
  }

  setOptedOut(address: string, optedOut: boolean, at: Date): void {
    if (optedOut) {
      this.db
        .prepare(
          'INSERT INTO opt_outs (address, opted_out_at) VALUES (?, ?) ON CONFLICT (address) DO NOTHING',
        )
        .run(address, at.getTime());
    } else {
      this.db.prepare('DELETE FROM opt_outs WHERE address = ?').run(address);
    }
  }

  // --- Webhook inbox ----------------------------------------------------------

  /** Records a delivery. Returns false when its id was seen before (a redelivery). */
  recordInbound(id: string, type: string, payload: string, at: Date): boolean {
    const result = this.db
      .prepare(
        'INSERT INTO inbox (id, type, payload, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      )
      .run(id, type, payload, at.getTime());
    return Number(result.changes) === 1;
  }

  getInbound(id: string): InboxRecord | undefined {
    const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined;
    return row === undefined ? undefined : toInbox(row);
  }

  markInbound(id: string, status: Exclude<InboxStatus, 'pending'>, at: Date, error?: string): void {
    this.db
      .prepare(
        'UPDATE inbox SET status = ?, attempts = attempts + 1, error = ?, processed_at = ? WHERE id = ?',
      )
      .run(status, error ?? null, at.getTime(), id);
  }

  /** Deliveries accepted but never processed (the process died mid-way). Oldest first. */
  pendingInbound(limit = 500): InboxRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM inbox WHERE status = 'pending' ORDER BY received_at LIMIT ?")
      .all(limit) as unknown as InboxRow[];
    return rows.map(toInbox);
  }

  /** Drops processed deliveries older than `before`; dedupe only needs a recent window. */
  pruneInbound(before: Date): number {
    const result = this.db
      .prepare("DELETE FROM inbox WHERE status != 'pending' AND received_at < ?")
      .run(before.getTime());
    return Number(result.changes);
  }

  // --- Flow tokens ------------------------------------------------------------

  saveFlowToken(record: FlowTokenRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO flow_tokens (token, address, example_id, flow_key, session_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.token,
        record.address,
        record.exampleId,
        record.flowKey,
        record.sessionId,
        at.getTime(),
        record.expiresAt.getTime(),
      );
  }

  getFlowToken(token: string): FlowTokenRecord | undefined {
    const row = this.db.prepare('SELECT * FROM flow_tokens WHERE token = ?').get(token) as
      | {
          token: string;
          address: string;
          example_id: string;
          flow_key: string;
          session_id: string;
          expires_at: number;
        }
      | undefined;
    return row === undefined
      ? undefined
      : {
          token: row.token,
          address: row.address,
          exampleId: row.example_id,
          flowKey: row.flow_key,
          sessionId: row.session_id,
          expiresAt: new Date(row.expires_at),
        };
  }

  pruneFlowTokens(before: Date): void {
    this.db.prepare('DELETE FROM flow_tokens WHERE expires_at < ?').run(before.getTime());
  }

  // --- Key-value --------------------------------------------------------------

  keyValue(namespace: string, clock: () => Date): KeyValueStore {
    return {
      get: <T>(key: string): T | undefined => {
        const row = this.db
          .prepare('SELECT value FROM kv WHERE namespace = ? AND key = ?')
          .get(namespace, key) as { value: string } | undefined;
        return row === undefined ? undefined : (JSON.parse(row.value) as T);
      },
      set: (key: string, value: unknown): void => {
        this.db
          .prepare(
            `INSERT INTO kv (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          )
          .run(namespace, key, JSON.stringify(value), clock().getTime());
      },
      delete: (key: string): void => {
        this.db.prepare('DELETE FROM kv WHERE namespace = ? AND key = ?').run(namespace, key);
      },
      list: <T>(prefix = ''): { key: string; value: T }[] => {
        const rows = this.db
          .prepare("SELECT key, value FROM kv WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key")
          .all(namespace, `${escapeLike(prefix)}%`) as unknown as { key: string; value: string }[];
        return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
      },
    };
  }

  /** Runs `work` in one transaction. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

interface InboxRow {
  id: string;
  type: string;
  payload: string;
  status: InboxStatus;
  attempts: number;
  received_at: number;
}

function toSession(row: SessionRow): SessionRecord {
  return {
    address: row.address,
    sessionId: row.session_id,
    exampleId: row.example_id,
    state: JSON.parse(row.state) as unknown,
    meta: { ...EMPTY_META, ...(JSON.parse(row.meta) as Partial<SessionMeta>) },
    startedAt: new Date(row.started_at),
    lastInboundAt: new Date(row.last_inbound_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toInbox(row: InboxRow): InboxRecord {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    receivedAt: new Date(row.received_at),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
