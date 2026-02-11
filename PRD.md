
# PRD: Assignment → Execution Packet System

## 1. Overview

### Product Name (working)
**Assignment Packet Generator**  

### One-line Description
A local-first system that converts an assignment specification into a structured execution packet, allowing the user to start from understanding and scaffolding rather than confusion.

### Product Type
Personal productivity and academic tooling  
Single-user, local-first (MVP)

### Design Philosophy
- Deterministic, auditable outputs
- Spec-first, schema-validated pipeline
- Human-in-the-loop by default
- “Compiler” mindset over conversational agent behavior

---

## 2. Problem Statement

### User Pain
When receiving a new assignment—especially in technical courses—the user experiences predictable friction:

- Requirements are implicit, fragmented, or buried in long specs
- Background concepts are assumed but unfamiliar
- Information is split across PDFs, slides, Piazza, and starter code
- The starting point is unclear, leading to wasted time and false starts
- Errors early in execution compound later in the assignment

This friction is highest for:
- Operating Systems and low-level systems courses
- Networking and distributed systems
- Databases and query-heavy assignments
- Algorithmic or proof-oriented problem sets
- Under-specified or ambiguous assignments

### Job to Be Done
> “When I receive an assignment, help me accurately understand what is required, what I need to know, and how to begin executing without guessing.”

---

## 3. Goals and Non-Goals

### Goals (MVP)
- Produce a **single, trusted execution document** per assignment
- Extract and normalize requirements, constraints, and interfaces
- Identify required background concepts and explain them in-context
- Generate a concrete, ordered execution checklist
- Reduce time-to-start and early-stage uncertainty
- Support assignments in unfamiliar technical domains

### Explicit Non-Goals (MVP)
- Submitting assignments or interacting with LMS platforms
- Fully solving complex systems projects end-to-end
- Replacing user reasoning or decision-making
- Scheduling calendar blocks or managing time
- Email triage, notifications, or reminders
- Multi-user support or cloud-first deployment

Human review and ownership of final work are always required.

---

## 4. Target User

### Primary User
- Computer science student
- Enrolled in upper-level or systems-heavy courses
- Comfortable with:
  - codebases
  - command-line interfaces
  - Markdown and structured documents
- Values correctness, structure, and clarity over polish or UI

### Usage Context
- Receives a new assignment
- Provides assignment materials (spec, slides, starter code)
- Generates an execution packet
- Uses the packet as the authoritative starting point for work

---

## 5. Core User Experience

### Inputs
Required:
- Assignment specification (PDF, README, or plain text)

Optional:
- Starter code repository or files
- Lecture slides or notes
- Syllabus excerpts relevant to the assignment

Inputs are treated as static artifacts and preserved for auditability.

---

### Outputs
For each assignment, the system generates a single **Assignment Packet** document.

The packet **must** contain the following sections:

1. **What You Are Building**
   - Plain-English summary of the assignment goal

2. **Acceptance Criteria**
   - Explicit conditions for correctness and completion

3. **Requirements Checklist**
   - Structured list of functional, constraint, interface, and grading requirements
   - Each requirement must include a source reference

4. **Required Concepts**
   - Concepts the user must understand to complete the assignment
   - Each concept explained only as deeply as necessary for execution

5. **System / Component Breakdown**
   - High-level decomposition of components, data flow, or responsibilities

6. **Execution Plan**
   - Ordered, concrete steps to move from zero state to completion

7. **Common Pitfalls and Edge Cases**
   - Known failure modes, ambiguities, or mistakes to avoid

8. **Validation and Testing Plan**
   - How the user can verify correctness incrementally

9. **Open Questions**
   - Ambiguities or clarifications to raise with a TA or instructor

Optional:
- Pseudocode
- Skeleton files

---

## 6. System Mental Model

The system operates as a **compiler-style pipeline**, not a conversational chatbot.

```
Assignment Artifacts  
↓  
Ingest & Normalize  
↓  
Requirement Extraction  
↓  
Concept Identification & Context Building  
↓  
Packet Synthesis  
↓  
Execution Packet (Artifact)

```

### Key Properties
- Each stage produces structured, validated outputs
- Later stages may only consume outputs from earlier stages
- All factual claims must trace back to source material
- Failures are explicit and surfaced early

---

## 7. Core System Constraints

### Determinism
- Given the same inputs, the system should produce equivalent outputs

### Auditability
- Every requirement and factual claim must reference a source artifact

### Safety
- The system must surface uncertainty instead of guessing

### Extensibility
- New domains (courses, assignment types) should require new inputs, not new logic paths

---

## 8. MVP Success Criteria

Qualitative:
- The user uses the packet instead of rereading the original spec
- The user reaches a “first meaningful step” faster
- The packet remains relevant throughout the assignment lifecycle

Quantitative (optional, later):
- Reduced time-to-first-code or proof
- Reduced number of clarification questions
- Reuse across multiple courses or semesters

---

## 9. Out-of-Scope (Future Work)

- Calendar and scheduling integration
- Email ingestion or notifications
- LMS scraping or syncing
- Automated test execution
- Multi-agent parallelism
- Multi-user or collaborative workflows

---

## 10. Guiding Principle

> If a feature does not directly help convert an assignment into executable understanding, it does not belong in this product.
