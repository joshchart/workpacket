import { appendFileSync, writeFileSync } from "node:fs";

export interface RunLogger {
  log(message: string): void;
}

export function createRunLogger(logPath: string): RunLogger {
  // Initialize the log file (truncate if exists)
  writeFileSync(logPath, "");

  return {
    log(message: string): void {
      const timestamp = new Date().toISOString();
      appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    },
  };
}
