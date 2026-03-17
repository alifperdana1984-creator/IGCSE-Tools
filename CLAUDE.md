# IGCSE Tools — App Instructions

## What This Is

A React + TypeScript SPA for generating Cambridge IGCSE exam-quality assessments using AI (Gemini, OpenAI, Anthropic). Teachers upload past papers and syllabuses as reference, configure subject/topic/difficulty, and the app generates syllabus-aligned questions with mark schemes.

---

## Tech Stack

- **React 19** + **TypeScript 5.8** + **Vite 6**
- **Tailwind CSS 4** (via `@tailwindcss/vite` plugin)
- **Firebase 12** (modular SDK v10): Auth (Google Sign-In), Firestore, Cloud Storage
- **AI SDKs**: `@google/genai` (Gemini), OpenAI via `fetch`, Anthropic via `fetch`
- **Math rendering**: KaTeX via `rehype-katex` + `remark-math`
- **PDF export**: `html2canvas` + `jsPDF`

---

## Firebase Project

**Separate project from other Eduversal apps — `igcse-tools` (NOT `centralhub-8727b`)**

| Field | Value |
|---|---|
| projectId | igcse-tools |
| authDomain | igcse-tools.firebaseapp.com |
| storageBucket | igcse-tools.firebasestorage.app |
| Config file | `firebase-applet-config.json` (committed — public keys only) |

Deploy rules from this directory:
```bash
cd "IGCSE Tools"
firebase deploy --only firestore:rules,storage --project igcse-tools
```

---

## Collections

| Collection | Purpose | Access |
|---|---|---|
| `assessments` | Saved assessment batches | Owner RW; public read if `isPublic=true` |
| `questions` | Individual saved questions | Owner RW; public read if `isPublic=true` |
| `folders` | Grouping containers | Owner only |
| `resources` | Uploaded PDFs (past papers, syllabuses) | Owner RW; shared read if `isShared=true` |
| `syllabusCache` | Extracted syllabus topics (AI-processed) | Owner only |
| `pastPaperCache` | Extracted past paper examples | Owner only |

---

## API Keys

**No shared/fallback API key.** Each user provides their own key via the in-app API Settings panel. Keys are stored in `localStorage` only (never sent to any server other than the respective AI provider).

Supported providers (configured in `src/lib/providers.ts`):
- **Gemini** (Google) — recommended; free tier via Google AI Studio (no credit card)
- **OpenAI** — paid; new accounts get $5 credit
- **Anthropic** — paid; new accounts get $5 credit

Free tier info and step-by-step instructions are shown in the UI when no key is entered (`FREE_TIER_INFO` in `providers.ts`). Do NOT add a shared/fallback key to `.env` or `vite.config.ts`.

---

## Development Setup

```bash
cd "IGCSE Tools"
npm install
npm run dev          # Vite dev server on port 3000
npm run build        # Production build → dist/
npm run lint         # TypeScript type check
npm run test         # Vitest unit tests
```

No `.env` values are required for local development. Users provide API keys in-browser.

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/lib/gemini.ts` | Gemini generation, audit, feedback, file upload; all prompts; `DIFFICULTY_GUIDANCE`, `SUBJECT_SPECIFIC_RULES`, `MARK_SCHEME_FORMAT`, `CAMBRIDGE_COMMAND_WORDS`, `ASSESSMENT_OBJECTIVES` |
| `src/lib/providers.ts` | Provider configs, model lists, `FREE_TIER_INFO` (free/paid badge + setup steps) |
| `src/lib/ai.ts` | Provider router (Gemini / OpenAI / Anthropic) |
| `src/lib/firebase.ts` | Firebase SDK init, all Firestore + Storage operations incl. GDPR `deleteUserData` |
| `src/lib/types.ts` | TypeScript interfaces — `QuestionItem` has `assessmentObjective`, `options` fields |
| `src/lib/sanitize.ts` | Post-generation question sanitization, normalises `assessmentObjective` |
| `src/hooks/useGeneration.ts` | React hook: generation state + orchestration |
| `src/hooks/useResources.ts` | React hook: resource upload, caching, management |
| `src/components/Sidebar/` | Config sidebar, resource manager, API settings (free tier guidance) |
| `src/components/AssessmentView/` | Main question editor and viewer |
| `src/components/Library/` | Assessment / question library browser |

---

## Deployment

- **Platform**: Vercel (automatic deploy on push to `main`)
- **Config**: `vercel.json` (CSP + security headers)
- **Build output**: `dist/` (gitignored)

---

## Question Generation Architecture

Questions are generated in `src/lib/gemini.ts` via `generateTest()`:
1. Prompt built from `DIFFICULTY_GUIDANCE` + `SUBJECT_SPECIFIC_RULES` + `MARK_SCHEME_FORMAT`
2. Reference PDFs (past papers, syllabuses) prepended as context via `buildReferenceParts()`
3. Gemini returns structured JSON (enforced via `responseSchema`)
4. `sanitizeQuestion()` normalises output (strips numbering, merges MCQ options, validates `assessmentObjective`)
5. For `Challenging` difficulty: `critiqueForDifficulty()` runs a second pass to audit and rewrite low-scoring questions

**Question fields:**
- `assessmentObjective`: `'AO1'` | `'AO2'` | `'AO3'` — Cambridge Assessment Objective
- `difficultyStars`: `1` | `2` | `3` — cognitive demand rating
- `syllabusObjective`: `"REF – statement"` format (e.g. `"C4.1 – Define the term acid"`)
- `type`: `'mcq'` | `'short_answer'` | `'structured'`
- Structured questions use **(a)**, **(b)**, **(c)** sub-part format with a shared context stem

---

## Security Notes

- **CSP headers** defined in `vercel.json` — update if new external domains are added
- **`syllabusCache` / `pastPaperCache`** Firestore rules: owner-only read (not world-readable)
- **GDPR `deleteUserData()`**: deletes Firestore docs AND Storage files under `resources/{uid}/`
- **`.env`** is intentionally empty — no secrets committed

---

## Common Mistakes

1. **Never add a shared/fallback API key** — keys must be user-provided only (security).
2. **Never commit `.env` with real API keys** — `.env` is gitignored and intentionally empty.
3. **Firestore rules must be redeployed** after editing `firestore.rules` — changes do NOT take effect automatically.
4. **Storage rules must be redeployed** separately if `storage.rules` changes.
5. This Firebase project (`igcse-tools`) is completely separate from `centralhub-8727b`.
6. **Adding a new AI provider**: update `providers.ts` (labels, models, URLs, `FREE_TIER_INFO`) AND add a new provider file in `src/lib/`, then wire it in `ai.ts`.
