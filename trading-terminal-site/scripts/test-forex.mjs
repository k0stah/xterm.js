import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");

rmSync(".tmp-test", { force: true, recursive: true });
mkdirSync(".tmp-test/types", { recursive: true });

const compile = spawnSync(
  process.execPath,
  [
    tsc,
    "--outDir",
    ".tmp-test",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "--skipLibCheck",
    "--types",
    "node",
    "--lib",
    "ES2022,DOM",
    "--esModuleInterop",
    "--noEmit",
    "false",
    "lib/forex/decimal.ts",
    "lib/forex/chart.ts",
    "lib/forex/market.ts",
    "lib/forex/simulation.ts",
    "lib/forex/portfolio.ts",
  ],
  { stdio: "inherit" },
);

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const test = spawnSync(process.execPath, ["--test", "test/forex.test.mjs"], {
  stdio: "inherit",
});

process.exit(test.status ?? 1);
