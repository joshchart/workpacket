import type { RunConfig } from "./run-config.js";
import type { StageName } from "./run-metadata.js";

/**
 * RunContext is passed to every stage during pipeline execution.
 * It provides access to run configuration and shared services.
 * Access output_dir via config.output_dir.
 */
export interface RunContext {
  readonly config: RunConfig;
  readonly run_id: string;
}

/**
 * Stage is the generic contract for pipeline stages.
 * Each stage is a pure-ish async function that transforms input to output.
 */
export type Stage<I, O> = (input: I, ctx: RunContext) => Promise<O>;

/**
 * StageDefinition pairs a stage function with its name for orchestrator use.
 */
export interface StageDefinition<I, O> {
  readonly name: StageName;
  readonly run: Stage<I, O>;
}
