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

**Pre-MVP.** Core Zod schemas for pipeline stages are implemented. The CLI, orchestrator, and pipeline stages are not yet built.

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
# Clone the repository
git clone <repo-url>
cd workpacket

# Install dependencies
bun install
```

## Usage (Planned)

```bash
# Full pipeline: ingest materials and generate packet
workpacket build <assignment_dir>

# Ingest only: parse and index assignment materials
workpacket ingest <assignment_dir>

# Generate packet from previously ingested assignment
workpacket packet <assignment_id>

# Enable draft mode (generates code scaffolds where appropriate)
workpacket build <assignment_dir> --draft
```

## Architecture

workpacket operates as a **compiler-style pipeline** with deterministic stages:

```
Assignment Artifacts
        ↓
Ingest & Normalize (parse → chunk → index)
        ↓
Extract Requirements (JSON, schema-validated, cited)
        ↓
Map Concepts + Build Primer (JSON + Markdown)
        ↓
Generate Packet (Markdown, template + invariants)
        ↓
(Optional) Draft Mode
```

### Key Components

| Component | Responsibility |
|-----------|----------------|
| **CLI** | Accept paths/config, call orchestrator, print summary |
| **Orchestrator** | Run stages in order, validate outputs, handle retries |
| **Stages** | Pure-ish functions with Zod-validated inputs/outputs |
| **Retrieval** | SQLite FTS5 keyword search for relevant chunks |
| **Storage** | SQLite metadata + artifacts on disk |

### Output Structure

Each run produces:

```
workpacket_runs/<assignment_id>/
  chunks.jsonl        # Parsed and indexed content
  requirements.json   # Extracted requirements with citations
  concepts.json       # Required concepts mapped to requirements
  primer.md           # Just-enough concept explanations
  packet.md           # Final execution packet
  run.json            # Run metadata for debugging
  run.log             # Detailed execution log
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
- **Storage:** SQLite with FTS5

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
  schemas/           # Zod schemas for pipeline contracts
    source-ref.ts    # Source reference (file + location)
    chunk.ts         # Content chunk with source ref
    requirement.ts   # Extracted requirement schema
    concept.ts       # Concept mapping schema
    run-config.ts    # Run configuration
    run-metadata.ts  # Run status and metadata
    stage.ts         # Stage type definitions
```

## Documentation

- [PRD.md](./PRD.md) — Product requirements, user persona, output format specification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Detailed system design, component contracts, failure modes

## License

TBD
