export type DecimalString = string;

const SCALE = 8n;
const FACTOR = 100000000n;

function normalizeInput(value: string | number | bigint): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Decimal value must be finite.");
    }
    return value.toString();
  }
  return value.trim();
}

export function parseDecimal(value: string | number | bigint): bigint {
  const normalized = normalizeInput(value);
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal value: ${normalized}`);
  }

  const [, sign, whole, fraction = ""] = match;
  const padded = `${fraction.slice(0, Number(SCALE))}${"0".repeat(Number(SCALE))}`.slice(0, Number(SCALE));
  const parsed = BigInt(whole) * FACTOR + BigInt(padded);
  return sign === "-" ? -parsed : parsed;
}

export function formatDecimal(value: bigint, places = 8): DecimalString {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(Number(SCALE), "0");
  const trimmed =
    places >= 0
      ? fraction.slice(0, places).padEnd(places, "0")
      : fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

export function toDecimal(value: string | number | bigint, places = 8): DecimalString {
  return formatDecimal(parseDecimal(value), places);
}

export function addDecimal(a: DecimalString, b: DecimalString, places = 8): DecimalString {
  return formatDecimal(parseDecimal(a) + parseDecimal(b), places);
}

export function subtractDecimal(a: DecimalString, b: DecimalString, places = 8): DecimalString {
  return formatDecimal(parseDecimal(a) - parseDecimal(b), places);
}

export function multiplyDecimal(a: DecimalString, b: DecimalString, places = 8): DecimalString {
  return formatDecimal((parseDecimal(a) * parseDecimal(b)) / FACTOR, places);
}

export function divideDecimal(a: DecimalString, b: DecimalString, places = 8): DecimalString {
  const divisor = parseDecimal(b);
  if (divisor === 0n) {
    throw new Error("Cannot divide by zero.");
  }
  return formatDecimal((parseDecimal(a) * FACTOR) / divisor, places);
}

export function compareDecimal(a: DecimalString, b: DecimalString): number {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function isPositiveDecimal(value: DecimalString): boolean {
  return parseDecimal(value) > 0n;
}

export function absDecimal(value: DecimalString, places = 8): DecimalString {
  const parsed = parseDecimal(value);
  return formatDecimal(parsed < 0n ? -parsed : parsed, places);
}

export function negateDecimal(value: DecimalString, places = 8): DecimalString {
  return formatDecimal(-parseDecimal(value), places);
}

export function minDecimal(a: DecimalString, b: DecimalString, places = 8): DecimalString {
  return compareDecimal(a, b) <= 0 ? toDecimal(a, places) : toDecimal(b, places);
}

export function isZeroDecimal(value: DecimalString): boolean {
  return parseDecimal(value) === 0n;
}

export function decimalToNumber(value: DecimalString): number {
  return Number(formatDecimal(parseDecimal(value), 8));
}
