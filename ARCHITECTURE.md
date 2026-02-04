# ARCHITECTURE.md — workpacket

## 1. Purpose

**workpacket** converts assignment materials (specs, slides, starter code) into a structured **Execution Packet** that helps a student understand requirements, learn missing concepts, and begin execution safely.

This system is **not** a planner, scheduler, notifier, or auto-submitter. It is a **compiler-style pipeline** that produces auditable artifacts.

---

## 2. Design Principles

- **Pipeline over agent soup**: deterministic stages with explicit inputs/outputs.
- **Spec-first contracts**: structured outputs validated at runtime (Zod).
- **Auditability**: every requirement/concept must trace back to a source reference.
- **Human-in-the-loop**: drafts are optional.
- **Local-first**: runs on a single machine; outputs saved to disk.
- **Minimal retrieval context**: chunk + retrieve relevant snippets; never dump entire PDFs.

---

## 3. High-Level Architecture

### 3.1 System Overview

```

CLI
↓
Orchestrator (runs stages, enforces policies, retries on validation failure)
↓
Stages (LLM + retrieval + validation)
↓
Storage (SQLite metadata + artifacts on disk)
↓
Outputs (packet.md + JSON intermediates + logs)

```

### 3.2 Compiler-Style Pipeline

```

Assignment Artifacts
↓
Ingest & Normalize (parse → chunk → index)
↓
Extract Requirements (JSON, schema-validated, cited)
↓
Map Concepts + Build Primer (JSON + Markdown, cited)
↓
Generate Packet (Markdown, template + invariants)
↓
(Optional) Draft Mode

````

---

## 4. Runtime Choices

### 4.1 Language / Runtime
- **TypeScript** running on **Bun** (Node-compatible runtime)
- Strict TS configuration enabled

### 4.2 Validation
- **Zod** schemas enforce contracts between stages
- Outputs that fail validation trigger a controlled retry or fail fast

### 4.3 Storage
- **SQLite** for metadata + retrieval index (FTS)
- Artifacts stored on disk as Markdown/JSON

---

## 5. Key Components

### 5.1 CLI
Primary interface (MVP). Example commands:
- `workpacket build <assignment_dir>`
- `workpacket ingest <assignment_dir>`
- `workpacket packet <assignment_id>`

The CLI is responsible for:
- accepting paths and run configuration
- calling the orchestrator
- printing a concise run summary and output paths

---

### 5.2 Orchestrator
The orchestrator coordinates the pipeline and enforces rules.

Responsibilities:
- determine which stages to run and in what order
- retrieve minimal relevant context for each stage
- validate each stage output (Zod + invariants)
- retry on schema failures (bounded retries)
- persist all intermediates and artifacts
- produce a run log for debugging and auditability

Non-responsibilities:
- it does not contain domain logic (OS/DB/etc.)
- it does not “reason” about requirements; stages do

---

### 5.3 Ingest Layer
Converts files into normalized chunks with stable source refs.

Inputs:
- PDFs (specs, slides)
- README/markdown/text
- optional starter code text (selected files)

Outputs:
- `chunks.jsonl` (or equivalent)
- SQLite rows for chunks and file metadata

Chunk schema (conceptual):
- `chunk_id`
- `file_id`
- `text`
- `source_ref` (file + page/section/line range)

---

### 5.4 Retrieval Layer
Returns relevant chunks for a stage.

MVP retrieval strategy:
- SQLite **FTS5** keyword retrieval + heuristics

Heuristics:
- prioritize spec over slides for requirements extraction
- prioritize slides/notes for concept explanations
- cap retrieval budget (avoid over-context)

Future option:
- embeddings-based retrieval (only if needed)

---

### 5.5 Stages
Stages are pure-ish functions with clear contracts:

```ts
type Stage<I, O> = (input: I, ctx: RunContext) => Promise<O>;
````

Each stage:

* requests relevant chunks via retrieval
* calls LLM with a strict prompt and expected output format
* validates output using Zod
* returns structured output to the orchestrator

#### Stage: Extract Requirements

Goal:

* produce a normalized list of requirements and constraints with citations

Output:

* `requirements.json` (validated)
* every item must include `source_ref`

#### Stage: Map Concepts

Goal:

* identify concepts required to complete the assignment
* map them to requirements

Outputs:

* `concepts.json` (validated)
* `source_refs` should point to spec and/or slides

#### Stage: Explain Concepts (Primer)

Goal:

* generate “just enough” explanations tailored to the assignment

Output:

* `primer.md`
* citations required for key claims (as source refs)

#### Stage: Generate Packet

Goal:

* produce the final `packet.md` strictly following the template

Output:

* `packet.md`
* validated via packet invariants (required sections present, tables filled)

#### Optional Stage: Draft Mode

Goal:

* produce drafts only when explicitly enabled and allowed

Rules:

* disabled by default
* allowed for “safe” assignment types (e.g., writing/SQL) or explicit user enablement
* for systems projects, default to pseudocode + scaffolding only

---

## 6. Output Artifacts

Each run produces a folder:

```
workpacket_runs/<assignment_id>/
  inputs/                 (optional copy or references)
  chunks.jsonl
  requirements.json
  concepts.json
  primer.md
  packet.md
  run.json
  run.log
```

Artifacts are designed to be:

* human-readable
* diffable
* easy to share or paste into Notion

---

## 7. Contracts and Validation

### 7.1 Zod Schemas

Zod schemas exist for:

* `requirements` output
* `concepts` output
* optional structured packet representation (future)

### 7.2 Packet Invariants

Packet validation is enforced as invariant checks, including:

* required headings exist (exact section names)
* requirements table is non-empty
* acceptance criteria present
* open questions present (even if “None”)
* no placeholder tokens like `TBD`
* citations/source refs present where required

Failures:

* trigger bounded retries (if fixable)
* otherwise fail with a clear error and saved intermediates

---

## 8. Policies / Guardrails

### 8.1 Human-in-the-loop

* The system produces **reviewable artifacts**.
* It does not submit work or interact with LMS/email/calendar in MVP.

### 8.2 No Guessing

When the spec is ambiguous or missing:

* list **Open Questions**
* do not invent requirements or interfaces

### 8.3 Draft Gating

Draft output requires:

* explicit flag (e.g., `--draft`)
* assignment type allowlist or user override

---

## 9. Protocols (MCP / A2A)

### MVP

* No external protocol required.
* Tools are internal functions.

### Future: MCP

MCP may be introduced to standardize tool interfaces (file read/search/write, Notion export, etc.) without changing core orchestration logic.

### A2A

Not planned for single-user local-first architecture. Consider only if splitting agents into separate services.

---

## 10. Failure Modes and Debuggability

workpacket is designed to fail loudly and leave traces:

* all intermediate artifacts are written
* `run.json` records stage inputs/outputs
* errors include the stage name and validation output

Common failures:

* malformed JSON from LLM → retry with “fix to schema”
* missing citations/source refs → retry with stricter instruction
* packet missing required headings → retry with template emphasis
* retrieval misses key spec section → adjust selectors or query terms

---

## 11. Scalability and Extensibility

### Extending to new classes

No code changes should be required for new classes. Only inputs change:

* different specs
* different slide decks
* different terminology

### Adding integrations later

* Notion export
* Google Drive ingestion
* test execution harness
* UI layer

All should sit on top of the pipeline without rewriting stage contracts.

---

## 12. Guiding Principle

> If a feature does not directly help convert assignment materials into executable understanding, it does not belong in workpacket.
