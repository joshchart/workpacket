# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**workpacket** is a local-first, compiler-style pipeline that converts assignment materials (specs, slides, starter code) into structured "Execution Packets" — documents that help students understand requirements, learn concepts, and begin work without guessing.

This is **not** a conversational agent, planner, scheduler, or auto-submitter. It produces deterministic, auditable artifacts.

## Status

All five core pipeline stages are implemented and working end-to-end. The CLI (`build`, `ingest`, `packet`, `login`), orchestrator, SQLite FTS5 storage layer, and Zod schema contracts are complete. The test suite covers all stages, schemas, CLI, and core modules.

## Operating Rules (Hard Constraints)

These rules are mandatory when making changes in this repository.

- Do NOT implement the entire project in one pass.
- Make small, reviewable changes (one module or one concern per task).
- Do NOT add dependencies unless explicitly instructed.
- Prefer simple, boring solutions over abstractions or frameworks.
- If anything is ambiguous, state assumptions and leave TODOs rather than guessing.
- Do not modify `PRD.md` or `ARCHITECTURE.md` unless explicitly asked.
- Persist intermediate artifacts to disk so results are inspectable.

## Technology Stack

- **Language**: TypeScript with strict configuration
- **Runtime**: Bun
- **Validation**: Zod schemas enforce contracts between pipeline stages
- **Storage**: SQLite with FTS5 for chunk retrieval; artifacts stored as Markdown/JSON on disk

## Architecture

The system is a linear compiler-style pipeline, not an agent graph:

```
CLI → Orchestrator → Stages → Storage → Outputs
```

**Pipeline stages** (each is a pure-ish function `Stage<I, O>`):
1. **Ingest & Normalize** — parse files into chunks with stable source refs → `chunks.json`
2. **Extract Requirements** — produce `requirements.json` with citations
3. **Map Concepts** — identify required concepts, map to requirements → `concepts.json`
4. **Explain Concepts** — generate `primer.md` with just-enough explanations
5. **Generate Packet** — produce final `packet.md` following a strict template (template may be invented initially; later it will be formalized in spec/packet_template.md)

**Key components**:
- **CLI**: accepts paths/config, calls orchestrator, prints summary (`workpacket build`, `workpacket ingest`, `workpacket packet`)
- **Orchestrator**: runs stages in order, validates outputs (Zod + invariants), retries on failure, persists all intermediates
- **Retrieval Layer**: SQLite FTS5 keyword search with heuristics (spec prioritized for requirements, slides for concepts)

**Output structure** per run:
```
workpacket_runs/<assignment_id>/
  chunks.json
  requirements.json
  concepts.json
  primer.md
  packet.md
  run.json
  run.log
```

## Design Principles

- **Pipeline over agent soup**: deterministic stages with explicit inputs/outputs
- **Spec-first contracts**: Zod schemas validated at runtime between every stage
- **Auditability**: every requirement/concept must trace back to a source reference
- **Human-in-the-loop**: system produces reviewable artifacts, never submits work
- **No guessing**: ambiguities become Open Questions, never invented requirements
- **Local-first**: single machine, outputs to disk

## Key Invariants

Packet validation enforces: required headings present, requirements table non-empty, acceptance criteria present, open questions section exists, no `TBD` placeholders, citations present where required. Failures trigger bounded retries, then fail-fast with saved intermediates.

## Custom Commands

- `/create_plan` — interactive plan creation workflow with parallel research agents; writes plans to `thoughts/plans/`
- `/implement_plan` — implements an approved plan phase-by-phase with automated + manual verification gates
- `/research_codebase` — comprehensive codebase research using parallel sub-agents; writes findings to `thoughts/research/`
- `/validate_plan` — validates implementation against plan, verifies success criteria

## Reference Documents

- `PRD.md` — product requirements, user persona, output format specification
- `ARCHITECTURE.md` — detailed system design, component contracts, failure modes, extensibility
