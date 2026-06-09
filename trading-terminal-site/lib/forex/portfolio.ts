import {
  absDecimal,
  addDecimal,
  compareDecimal,
  divideDecimal,
  isPositiveDecimal,
  multiplyDecimal,
  negateDecimal,
  toDecimal,
  type DecimalString,
} from "./decimal.js";
import {
  calculateOrderCashDeltaUsd,
  calculateRealizedPnlUsd,
  calculateUnrealizedPnlUsd,
  isSupportedSymbol,
  nextAverageEntryPrice,
  type ForexSymbol,
  type Quote,
} from "./market.js";

export type OrderSide = "buy" | "sell";

export type PositionState = {
  symbol: ForexSymbol;
  quantity: DecimalString;
  averageEntryPrice: DecimalString;
  realizedPnlUsd: DecimalString;
};

export type AccountState = {
  cashBalanceUsd: DecimalString;
  realizedPnlUsd: DecimalString;
  positions: PositionState[];
};

export type ExecutionResult = {
  executionPrice: DecimalString;
  cashBalanceUsd: DecimalString;
  realizedPnlUsd: DecimalString;
  position: PositionState;
};

export function executeMarketOrder(
  account: AccountState,
  symbol: ForexSymbol,
  side: OrderSide,
  quantity: DecimalString,
  prices: Partial<Record<ForexSymbol, Quote>>,
  allowShortSelling: boolean,
): ExecutionResult {
  if (!isSupportedSymbol(symbol)) {
    throw new Error("UNSUPPORTED_SYMBOL");
  }
  if (!isPositiveDecimal(quantity)) {
    throw new Error("Quantity must be positive.");
  }
  const quote = prices[symbol];
  if (!quote || quote.anchorStale) {
    throw new Error("Current simulator price is unavailable or stale.");
  }

  const executionPrice = side === "buy" ? quote.ask : quote.bid;
  const signedOrderQuantity = side === "buy" ? toDecimal(quantity, 8) : negateDecimal(quantity, 8);
  const existing =
    account.positions.find((position) => position.symbol === symbol) ?? {
      symbol,
      quantity: "0.00000000",
      averageEntryPrice: "0.00000000",
      realizedPnlUsd: "0.00000000",
    };

  const nextPosition = nextAverageEntryPrice(
    existing.quantity,
    existing.averageEntryPrice,
    signedOrderQuantity,
    executionPrice,
  );
  if (!allowShortSelling && compareDecimal(nextPosition.quantity, "0") < 0) {
    throw new Error("Short selling is disabled.");
  }

  const cashDelta = calculateOrderCashDeltaUsd(
    symbol,
    side,
    quantity,
    executionPrice,
    prices,
  );
  const nextCash = addDecimal(account.cashBalanceUsd, cashDelta, 8);
  if (compareDecimal(nextCash, "0") < 0) {
    throw new Error("Insufficient available cash.");
  }

  const realizedForOrder =
    compareDecimal(nextPosition.closedQuantityAbs, "0") > 0
      ? calculateRealizedPnlUsd(
          symbol,
          nextPosition.closedQuantityAbs,
          existing.quantity,
          existing.averageEntryPrice,
          executionPrice,
          prices,
        )
      : "0.00000000";
  const positionRealized = addDecimal(existing.realizedPnlUsd, realizedForOrder, 8);

  return {
    executionPrice,
    cashBalanceUsd: nextCash,
    realizedPnlUsd: addDecimal(account.realizedPnlUsd, realizedForOrder, 8),
    position: {
      symbol,
      quantity: nextPosition.quantity,
      averageEntryPrice: nextPosition.averageEntryPrice,
      realizedPnlUsd: positionRealized,
    },
  };
}

export function summarizeAccount(
  account: AccountState,
  prices: Partial<Record<ForexSymbol, Quote>>,
): {
  cashBalanceUsd: DecimalString;
  realizedPnlUsd: DecimalString;
  unrealizedPnlUsd: DecimalString;
  equityUsd: DecimalString;
} {
  const unrealizedPnlUsd = account.positions.reduce(
    (total, position) =>
      addDecimal(
        total,
        calculateUnrealizedPnlUsd(
          position.symbol,
          position.quantity,
          position.averageEntryPrice,
          prices,
        ),
        8,
      ),
    "0.00000000",
  );
  return {
    cashBalanceUsd: account.cashBalanceUsd,
    realizedPnlUsd: account.realizedPnlUsd,
    unrealizedPnlUsd,
    equityUsd: addDecimal(account.cashBalanceUsd, unrealizedPnlUsd, 8),
  };
}

export function formatMoney(value: DecimalString): string {
  return toDecimal(value, 2);
}

export function formatQuantity(value: DecimalString): string {
  return toDecimal(value, 2);
}

export function positionSide(quantity: DecimalString): "long" | "short" | "flat" {
  const compared = compareDecimal(quantity, "0");
  return compared > 0 ? "long" : compared < 0 ? "short" : "flat";
}

export function requiredCloseQuantity(previous: DecimalString, order: DecimalString): DecimalString {
  if (compareDecimal(previous, "0") === 0) {
    return "0.00000000";
  }
  const previousAbs = absDecimal(previous, 8);
  const orderAbs = absDecimal(order, 8);
  return compareDecimal(previousAbs, orderAbs) < 0 ? previousAbs : orderAbs;
}

export function averageEntryForIncrease(
  previousQuantity: DecimalString,
  previousAverage: DecimalString,
  addedQuantity: DecimalString,
  executionPrice: DecimalString,
): DecimalString {
  const totalCost = addDecimal(
    multiplyDecimal(absDecimal(previousQuantity, 8), previousAverage, 8),
    multiplyDecimal(absDecimal(addedQuantity, 8), executionPrice, 8),
    8,
  );
  return divideDecimal(totalCost, addDecimal(absDecimal(previousQuantity, 8), absDecimal(addedQuantity, 8), 8), 8);
}
