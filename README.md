# workpacket

A local-first, compiler-style pipeline that converts assignment materials (specs, slides, starter code) into structured **Execution Packets** — documents that help students understand requirements, learn concepts, and begin work without guessing.

## What It Does

When you receive a new assignment, workpacket processes your materials and produces a single, structured document containing:

- **What You Are Building** — plain-English summary of the goal
- **Acceptance Criteria** — explicit conditions for completion
- **Requirements Checklist** — structured list with source citations
- **Required Concepts** — explanations tailored to the assignment
- **System/Component Breakdown** — high-level architecture
- **Execution Plan** — ordered steps from zero to completion
- **Common Pitfalls** — known failure modes to avoid
- **Validation Plan** — how to verify correctness incrementally
- **Open Questions** — ambiguities to clarify with instructors

## What It Is Not

workpacket is **not** a conversational agent, planner, scheduler, or auto-submitter. It produces deterministic, auditable artifacts. Human review and ownership of final work are always required.

## Status

**MVP complete.** All five pipeline stages, the CLI, orchestrator, storage layer, and test suite are implemented and working end-to-end.

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
# Clone the repository
git clone <repo-url>
cd workpacket

# Install dependencies
bun install
```

## Usage

```bash
# Authenticate (opens browser, required before first run)
workpacket login

# Full pipeline: ingest materials and generate packet
workpacket build <assignment_dir>

# Ingest only: parse and index assignment materials
workpacket ingest <assignment_dir>

# Generate packet from previously ingested assignment
workpacket packet <assignment_id>
```

You can also run via `bun`:

```bash
bun run cli build <assignment_dir>
bun run cli ingest <assignment_dir>
bun run cli packet <assignment_id>
```

### Options

| Flag | Command | Description |
|------|---------|-------------|
| `--output <dir>` | build, ingest, packet | Custom output directory (default: `workpacket_runs/<assignment_id>`) |
| `--help, -h` | all | Show help |

## Architecture

workpacket operates as a **compiler-style pipeline** with deterministic stages:

```
Assignment Materials (.md, .txt)
        |
        v
  Ingest & Normalize ──> chunks.json + SQLite FTS5 index
        |
        v
  Extract Requirements ──> requirements.json
        |
        v
  Map Concepts ──> concepts.json
        |
        v
  Explain Concepts ──> primer.md
        |
        v
  Generate Packet ──> packet.md
```

Each stage is a pure-ish async function that reads from prior outputs, calls an LLM, validates the result with Zod, and writes to disk. The orchestrator coordinates execution, retries validation failures (up to 2 attempts), and persists all intermediates.

### Key Components

| Component | Responsibility |
|-----------|----------------|
| **CLI** | Accept paths/config, call orchestrator, print summary |
| **Orchestrator** | Run stages in order, validate outputs, handle retries |
| **Stages** | Pure-ish functions with Zod-validated inputs/outputs |
| **Retrieval** | SQLite FTS5 keyword search with file-tag bias |
| **Storage** | SQLite metadata + artifacts on disk |

### Output Structure

Each run produces:

```
workpacket_runs/<assignment_id>/
  chunks.db              # SQLite database with FTS5 index
  chunks.json            # Parsed and indexed content
  requirements.json      # Extracted requirements with citations
  concepts.json          # Required concepts mapped to requirements
  primer.md              # Just-enough concept explanations
  packet.md              # Final execution packet
  run.json               # Run metadata and stage completion status
  run.log                # Detailed execution log
```

## Design Principles

- **Pipeline over agent soup** — deterministic stages with explicit inputs/outputs
- **Spec-first contracts** — Zod schemas validated at runtime between every stage
- **Auditability** — every requirement/concept traces back to source material
- **Human-in-the-loop** — produces reviewable artifacts, never submits work
- **No guessing** — ambiguities become Open Questions, never invented requirements
- **Local-first** — single machine, outputs to disk

## Technology Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Validation:** Zod schemas
- **Storage:** SQLite with FTS5 (via `bun:sqlite`)
- **LLM:** OpenAI Codex API with OAuth authentication

## Development

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

## Project Structure

```
src/
  cli/
    main.ts              # CLI entry point
    commands.ts          # build, ingest, packet, login commands
    parse-args.ts        # Argument parsing
    help.ts              # Usage text
  stages/
    ingest.ts            # Stage 1: file discovery, chunking, tagging
    extract-requirements.ts  # Stage 2: LLM-based requirement extraction
    map-concepts.ts      # Stage 3: concept identification and mapping
    explain-concepts.ts  # Stage 4: primer generation
    generate-packet.ts   # Stage 5: final packet with invariant checks
  schemas/
    chunk.ts             # Content chunk schema
    requirement.ts       # Requirement schema
    concept.ts           # Concept mapping schema
    primer-output.ts     # Primer output schema
    packet-output.ts     # Packet output schema
    source-ref.ts        # Source reference schema
    file-tag.ts          # File tag enum
    ingest-output.ts     # Ingest output schema
    run-config.ts        # Run configuration
    run-metadata.ts      # Run status and metadata
    stage.ts             # Stage type definitions
  orchestrator.ts        # Pipeline coordination and retry logic
  storage.ts             # SQLite FTS5 storage layer
  llm.ts                 # LLM client interface
  oauth.ts               # OAuth login flow
  auth.ts                # Token management
  logger.ts              # Run logging
```

## Documentation

- [PRD.md](./PRD.md) — Product requirements, user persona, output format specification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Detailed system design, component contracts, failure modes

## License

TBD
