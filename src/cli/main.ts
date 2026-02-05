#!/usr/bin/env bun
import { parseArgs } from "./parse-args.js";
import { runBuild, runIngest, runPacket } from "./commands.js";
import { MAIN_USAGE } from "./help.js";

async function main(): Promise<void> {
  const result = parseArgs(process.argv);

  if (!result.ok) {
    console.error(`Error: ${result.error.error}`);
    if (result.error.usage) {
      console.error(result.error.usage);
    }
    process.exit(1);
  }

  const { args } = result;

  switch (args.command) {
    case "help":
      console.log(MAIN_USAGE);
      break;
    case "build":
      await runBuild(args);
      break;
    case "ingest":
      await runIngest(args);
      break;
    case "packet":
      await runPacket(args);
      break;
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
