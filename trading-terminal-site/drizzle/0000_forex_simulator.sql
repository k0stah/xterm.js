CREATE TABLE `forex_anchor_rates` (
  `currency` text PRIMARY KEY NOT NULL,
  `rate` text NOT NULL,
  `observation_date` text NOT NULL,
  `retrieved_at` text NOT NULL,
  `source` text DEFAULT 'ECB' NOT NULL,
  `stale` integer DEFAULT false NOT NULL
);

CREATE TABLE `trading_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `account_currency` text DEFAULT 'USD' NOT NULL,
  `cash_balance_usd` text NOT NULL,
  `realized_pnl_usd` text DEFAULT '0.00000000' NOT NULL,
  `version` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `trading_accounts_user_id_unique` ON `trading_accounts` (`user_id`);

CREATE TABLE `positions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `account_id` text NOT NULL,
  `symbol` text NOT NULL,
  `quantity` text NOT NULL,
  `average_entry_price` text NOT NULL,
  `realized_pnl_usd` text DEFAULT '0.00000000' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `positions_user_symbol_unique` ON `positions` (`user_id`, `symbol`);
CREATE INDEX `positions_user_idx` ON `positions` (`user_id`);

CREATE TABLE `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `account_id` text NOT NULL,
  `client_order_id` text,
  `symbol` text NOT NULL,
  `side` text NOT NULL,
  `quantity` text NOT NULL,
  `order_type` text NOT NULL,
  `status` text NOT NULL,
  `execution_price` text,
  `executed_at` text,
  `rejection_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `orders_user_client_order_unique` ON `orders` (`user_id`, `client_order_id`);
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`, `created_at`);

CREATE TABLE `trades` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `account_id` text NOT NULL,
  `order_id` text NOT NULL,
  `symbol` text NOT NULL,
  `side` text NOT NULL,
  `quantity` text NOT NULL,
  `execution_price` text NOT NULL,
  `realized_pnl_usd` text NOT NULL,
  `executed_at` text NOT NULL
);

CREATE INDEX `trades_user_executed_idx` ON `trades` (`user_id`, `executed_at`);
