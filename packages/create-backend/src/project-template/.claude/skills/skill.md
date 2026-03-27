---
description: "Root skill index for XBG agentic builder libraries. Routes to the appropriate sub-skill based on the library and topic."
---

# XBG Agentic Builder Libraries

This repository contains libraries designed to accelerate AI-assisted application development. Each library has its own skill tree with detailed guidance for Claude.

---

## Available Libraries

| Library | Skill Path | Description |
|---|---|---|
| **Boilerplate Backend (bpbe)** | `bpbe/` | Production-ready Node.js/TypeScript backend on Firebase Functions + Firestore + Express.js |

---

## Boilerplate Backend — Quick Navigation

A 3-layer (Controller → Service → Repository) backend distributed as `@xbg.solutions/*` npm packages. AI generates business logic from declarative data models.

| Topic | Skill | Use when you need to... |
|---|---|---|
| Overview | `bpbe/skill.md` | Understand the architecture, philosophy, and how the pieces fit together |
| Setup | `bpbe/setup/skill.md` | Create a new project, configure .env, npm scripts, Firebase config, validation |
| Data | `bpbe/data/skill.md` | Define entities, repositories, DataModelSpecification, code generator, Firestore patterns |
| Services | `bpbe/services/skill.md` | Business logic, lifecycle hooks, access control, events, auth patterns |
| Utilities | `bpbe/utils/skill.md` | Logger, PII hashing, token handler, cache, email/SMS/push/CRM/LLM connectors |
| API | `bpbe/api/skill.md` | Controllers, routes, middleware, response shapes, wiring up index.ts |
