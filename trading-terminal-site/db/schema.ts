import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const forexAnchorRates = sqliteTable("forex_anchor_rates", {
  currency: text("currency").primaryKey(),
  rate: text("rate").notNull(),
  observationDate: text("observation_date").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  source: text("source").notNull().default("ECB"),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
});

export const tradingAccounts = sqliteTable("trading_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  accountCurrency: text("account_currency").notNull().default("USD"),
  cashBalanceUsd: text("cash_balance_usd").notNull(),
  realizedPnlUsd: text("realized_pnl_usd").notNull().default("0.00000000"),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userIdUnique: uniqueIndex("trading_accounts_user_id_unique").on(table.userId),
}));

export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  accountId: text("account_id").notNull(),
  symbol: text("symbol").notNull(),
  quantity: text("quantity").notNull(),
  averageEntryPrice: text("average_entry_price").notNull(),
  realizedPnlUsd: text("realized_pnl_usd").notNull().default("0.00000000"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userSymbolUnique: uniqueIndex("positions_user_symbol_unique").on(table.userId, table.symbol),
  userIndex: index("positions_user_idx").on(table.userId),
}));

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  accountId: text("account_id").notNull(),
  clientOrderId: text("client_order_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  orderType: text("order_type").notNull(),
  status: text("status").notNull(),
  executionPrice: text("execution_price"),
  executedAt: text("executed_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userClientOrderUnique: uniqueIndex("orders_user_client_order_unique").on(table.userId, table.clientOrderId),
  userCreatedIndex: index("orders_user_created_idx").on(table.userId, table.createdAt),
}));

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  accountId: text("account_id").notNull(),
  orderId: text("order_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  executionPrice: text("execution_price").notNull(),
  realizedPnlUsd: text("realized_pnl_usd").notNull(),
  executedAt: text("executed_at").notNull(),
}, (table) => ({
  userExecutedIndex: index("trades_user_executed_idx").on(table.userId, table.executedAt),
}));
