---
description: TypeScript type-safety best practices, patterns and common type issues
---

# TypeScript Patterns
- Avoid `any`; prefer `unknown` plus narrowing
- Avoid non-null assertions (`!`) and unchecked `as` casts
- Explicit return types on exported functions
- Discriminated unions, literal unions, `as const`, utility types (Pick, Omit, Record)
- Validate external data at runtime (Zod)
- Common issues: unhandled null/undefined, floating promises, duplicated interfaces
