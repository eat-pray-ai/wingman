# AGENTS.md — Wingman (`@eat-pray-ai/wingman`)

TypeScript CLI that reads local AI coding-agent usage data and produces shareable SVG stat cards and rendercv-compatible YAML resumes.
Pipeline: Agent Adapters → `UsageRecord[]` → Aggregator → `ShowcaseData` → Renderer → SVG / YAML.

---

## Quick Reference

```bash
npm run dev              # run CLI via tsx (no build needed)
npm run build            # bundle with tsdown → dist/
npx tsc --noEmit         # type-check only (no emit)
npm test                 # vitest run (all tests)
npx vitest run src/foo.test.ts          # single test file
npx vitest run -t "test name pattern"   # single test by name
npm run test:watch       # vitest in watch mode
```

- **Node 22** · **TypeScript strict** · **ESM** · **tsdown bundler** · No linter/formatter configured

---

## Documentation Index

| Guide | Scope |
|---|---|
| **[docs/AGENTS.md](docs/AGENTS.md)** | Code style, architecture, common patterns, dependencies |
| [src/AGENTS.md](src/AGENTS.md) | Source overview, module map, key types, extension points |
| [src/agents/AGENTS.md](src/agents/AGENTS.md) | Agent adapter contract, adding new agents |
| [src/themes/AGENTS.md](src/themes/AGENTS.md) | Theme renderer structure, section pattern |
| [src/svg/AGENTS.md](src/svg/AGENTS.md) | SVG component primitives, opts pattern |
| [src/pricing/AGENTS.md](src/pricing/AGENTS.md) | Pricing engine, model metadata, models.dev API |
| [src/resume/AGENTS.md](src/resume/AGENTS.md) | Resume YAML renderer for rendercv |
