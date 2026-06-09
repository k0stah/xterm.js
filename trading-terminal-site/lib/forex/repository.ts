import { compareDecimal, isPositiveDecimal, toDecimal } from "./decimal.js";
import {
  executeMarketOrder,
  summarizeAccount,
  type AccountState,
  type OrderSide,
  type PositionState,
} from "./portfolio.js";
import {
  normalizeSymbol,
  SUPPORTED_SYMBOLS,
  type ForexSymbol,
  type Quote,
} from "./market.js";

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
};

type AccountRow = {
  id: string;
  user_id: string;
  cash_balance_usd: string;
  realized_pnl_usd: string;
  version: number;
};

type PositionRow = {
  symbol: ForexSymbol;
  quantity: string;
  average_entry_price: string;
  realized_pnl_usd: string;
};

type OrderPayload = {
  symbol?: string;
  side?: string;
  quantity?: string;
  order_type?: string;
  client_order_id?: string;
};

const DEFAULT_STARTING_BALANCE = process.env.FOREX_DEFAULT_STARTING_BALANCE ?? "100000";
let schemaReady: Promise<void> | null = null;

export async function ensureSchema(db: D1DatabaseLike): Promise<void> {
  schemaReady ??= (async () => {
    const statements = [
      "CREATE TABLE IF NOT EXISTS forex_anchor_rates (currency text PRIMARY KEY NOT NULL, rate text NOT NULL, observation_date text NOT NULL, retrieved_at text NOT NULL, source text DEFAULT 'ECB' NOT NULL, stale integer DEFAULT false NOT NULL)",
      "CREATE TABLE IF NOT EXISTS trading_accounts (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, account_currency text DEFAULT 'USD' NOT NULL, cash_balance_usd text NOT NULL, realized_pnl_usd text DEFAULT '0.00000000' NOT NULL, version integer DEFAULT 0 NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS trading_accounts_user_id_unique ON trading_accounts (user_id)",
      "CREATE TABLE IF NOT EXISTS positions (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, account_id text NOT NULL, symbol text NOT NULL, quantity text NOT NULL, average_entry_price text NOT NULL, realized_pnl_usd text DEFAULT '0.00000000' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS positions_user_symbol_unique ON positions (user_id, symbol)",
      "CREATE INDEX IF NOT EXISTS positions_user_idx ON positions (user_id)",
      "CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, account_id text NOT NULL, client_order_id text, symbol text NOT NULL, side text NOT NULL, quantity text NOT NULL, order_type text NOT NULL, status text NOT NULL, execution_price text, executed_at text, rejection_reason text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS orders_user_client_order_unique ON orders (user_id, client_order_id)",
      "CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at)",
      "CREATE TABLE IF NOT EXISTS trades (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, account_id text NOT NULL, order_id text NOT NULL, symbol text NOT NULL, side text NOT NULL, quantity text NOT NULL, execution_price text NOT NULL, realized_pnl_usd text NOT NULL, executed_at text NOT NULL)",
      "CREATE INDEX IF NOT EXISTS trades_user_executed_idx ON trades (user_id, executed_at)",
    ];
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  })();
  await schemaReady;
}

export async function ensureAccount(db: D1DatabaseLike, userId: string): Promise<AccountRow> {
  await ensureSchema(db);
  const existing = await db
    .prepare("SELECT id, user_id, cash_balance_usd, realized_pnl_usd, version FROM trading_accounts WHERE user_id = ?")
    .bind(userId)
    .first<AccountRow>();
  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO trading_accounts (id, user_id, cash_balance_usd, realized_pnl_usd) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, toDecimal(DEFAULT_STARTING_BALANCE, 8), "0.00000000")
    .run();
  const created = await db
    .prepare("SELECT id, user_id, cash_balance_usd, realized_pnl_usd, version FROM trading_accounts WHERE user_id = ?")
    .bind(userId)
    .first<AccountRow>();
  if (!created) {
    throw new Error("Failed to create trading account.");
  }
  return created;
}

export async function loadPositions(db: D1DatabaseLike, userId: string): Promise<PositionState[]> {
  await ensureSchema(db);
  const result = await db
    .prepare(
      "SELECT symbol, quantity, average_entry_price, realized_pnl_usd FROM positions WHERE user_id = ? ORDER BY symbol",
    )
    .bind(userId)
    .all<PositionRow>();
  return (result.results ?? []).map((row) => ({
    symbol: row.symbol,
    quantity: row.quantity,
    averageEntryPrice: row.average_entry_price,
    realizedPnlUsd: row.realized_pnl_usd,
  }));
}

export async function loadAccountState(
  db: D1DatabaseLike,
  userId: string,
): Promise<{ account: AccountRow; state: AccountState }> {
  const account = await ensureAccount(db, userId);
  const positions = await loadPositions(db, userId);
  return {
    account,
    state: {
      cashBalanceUsd: account.cash_balance_usd,
      realizedPnlUsd: account.realized_pnl_usd,
      positions,
    },
  };
}

export async function getAccountSummary(
  db: D1DatabaseLike,
  userId: string,
  prices: Partial<Record<ForexSymbol, Quote>>,
) {
  const { account, state } = await loadAccountState(db, userId);
  return {
    accountId: account.id,
    accountCurrency: "USD",
    ...summarizeAccount(state, prices),
    positions: state.positions,
  };
}

export async function listOrders(db: D1DatabaseLike, userId: string, limit = 50) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      "SELECT id, client_order_id, symbol, side, quantity, order_type, status, execution_price, executed_at, rejection_reason, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all();
  return result.results ?? [];
}

export async function listTrades(db: D1DatabaseLike, userId: string, limit = 50) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      "SELECT id, order_id, symbol, side, quantity, execution_price, realized_pnl_usd, executed_at FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all();
  return result.results ?? [];
}

export async function getOrder(db: D1DatabaseLike, userId: string, orderId: string) {
  await ensureSchema(db);
  return db
    .prepare(
      "SELECT id, client_order_id, symbol, side, quantity, order_type, status, execution_price, executed_at, rejection_reason, created_at FROM orders WHERE user_id = ? AND id = ?",
    )
    .bind(userId, orderId)
    .first();
}

export async function createMarketOrder(
  db: D1DatabaseLike,
  userId: string,
  payload: OrderPayload,
  prices: Partial<Record<ForexSymbol, Quote>>,
  allowShortSelling: boolean,
) {
  const symbol = normalizeSymbol(payload.symbol ?? "");
  if (!SUPPORTED_SYMBOLS.includes(symbol as ForexSymbol)) {
    throw routeError("UNSUPPORTED_SYMBOL", "The requested symbol is not supported.", 400, { symbol });
  }
  if (payload.side !== "buy" && payload.side !== "sell") {
    throw routeError("INVALID_SIDE", "Order side must be buy or sell.", 400);
  }
  if (payload.order_type !== "market") {
    throw routeError("UNSUPPORTED_ORDER_TYPE", "Only market orders are supported.", 400);
  }
  const quantity = toDecimal(payload.quantity ?? "", 8);
  if (!isPositiveDecimal(quantity)) {
    throw routeError("INVALID_QUANTITY", "Quantity must be positive.", 400);
  }
  if (payload.client_order_id) {
    const existing = await db
      .prepare(
        "SELECT id, status, symbol, side, quantity, execution_price, executed_at FROM orders WHERE user_id = ? AND client_order_id = ?",
      )
      .bind(userId, payload.client_order_id)
      .first();
    if (existing) {
      return existing;
    }
  }

  const { account, state } = await loadAccountState(db, userId);
  let result;
  try {
    result = executeMarketOrder(
      state,
      symbol as ForexSymbol,
      payload.side,
      quantity,
      prices,
      allowShortSelling,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order rejected.";
    throw routeError("ORDER_REJECTED", message, 400);
  }

  const update = await db
    .prepare(
      "UPDATE trading_accounts SET cash_balance_usd = ?, realized_pnl_usd = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND version = ?",
    )
    .bind(result.cashBalanceUsd, result.realizedPnlUsd, userId, account.version)
    .run();
  if ((update.meta?.changes ?? 0) !== 1) {
    throw routeError(
      "CONCURRENT_ACCOUNT_UPDATE",
      "Account changed while the order was being executed. Please retry.",
      409,
    );
  }

  const orderId = crypto.randomUUID();
  const tradeId = crypto.randomUUID();
  const executedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO orders (id, user_id, account_id, client_order_id, symbol, side, quantity, order_type, status, execution_price, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      orderId,
      userId,
      account.id,
      payload.client_order_id ?? null,
      symbol,
      payload.side,
      quantity,
      "market",
      "filled",
      result.executionPrice,
      executedAt,
    )
    .run();

  await db
    .prepare(
      "INSERT INTO trades (id, user_id, account_id, order_id, symbol, side, quantity, execution_price, realized_pnl_usd, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      tradeId,
      userId,
      account.id,
      orderId,
      symbol,
      payload.side,
      quantity,
      result.executionPrice,
      result.position.realizedPnlUsd,
      executedAt,
    )
    .run();

  if (compareDecimal(result.position.quantity, "0") === 0) {
    await db
      .prepare("DELETE FROM positions WHERE user_id = ? AND symbol = ?")
      .bind(userId, symbol)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO positions (id, user_id, account_id, symbol, quantity, average_entry_price, realized_pnl_usd, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, symbol) DO UPDATE SET quantity = excluded.quantity, average_entry_price = excluded.average_entry_price, realized_pnl_usd = excluded.realized_pnl_usd, updated_at = CURRENT_TIMESTAMP",
      )
      .bind(
        `${userId}:${symbol}`,
        userId,
        account.id,
        symbol,
        result.position.quantity,
        result.position.averageEntryPrice,
        result.position.realizedPnlUsd,
      )
      .run();
  }

  return {
    id: orderId,
    status: "filled",
    symbol,
    side: payload.side as OrderSide,
    quantity,
    execution_price: result.executionPrice,
    executed_at: executedAt,
  };
}

export function routeError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
) {
  const error = new Error(message) as Error & {
    code: string;
    status: number;
    details?: Record<string, unknown>;
  };
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}
