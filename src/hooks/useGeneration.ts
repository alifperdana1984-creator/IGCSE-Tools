import { useState, useCallback } from "react";
import type {
  Assessment,
  QuestionItem,
  AnalyzeFileResult,
  GenerationConfig,
  AIError,
  Resource,
} from "../lib/types";
import type { AIProvider } from "../lib/providers";
import type { NotifyFn } from "./useNotifications";
import {
  generateTest,
  getStudentFeedback as aiFeedback,
  analyzeFile as aiAnalyze,
  auditTest as aiAudit,
} from "../lib/ai";
import { uploadToGeminiFileApi } from "../lib/gemini";
import { getSyllabusCache, getPastPaperCache } from "../lib/firebase";
import { Timestamp } from "firebase/firestore";
import { auth } from "../lib/firebase";
import { estimateCostIDR } from "../lib/pricing";

const GEMINI_URI_VALID_MS = 46 * 60 * 60 * 1000;

function normalizeGenerationQuestionType(type: string): string {
  const v = type.trim().toLowerCase();
  if (v === "multiple choice" || v === "multiple_choice" || v === "mcq")
    return 'MCQ (only type="mcq")';
  if (v === "short answer" || v === "short_answer")
    return 'Short Answer (only type="short_answer")';
  if (v === "structured") return 'Structured (only type="structured")';
  return "Mixed";
}

function formatPastPaperText(
  cache: {
    examples?: string;
    summary?: string;
    items?: Array<{
      questionText: string;
      commandWord: string;
      marks: number;
      markScheme: string;
      questionType?: string;
      difficultyBand?: string;
      topic?: string;
      tags?: string[];
      assessmentObjective?: string;
      tikzCode?: string;
    }>;
  },
  topicFilter?: string,
): string {
  if (cache.items && cache.items.length > 0) {
    let items = cache.items;
    if (topicFilter) {
      const normalizedTopic = topicFilter.toLowerCase().trim();
      // Split into individual keywords for partial matching
      const keywords = normalizedTopic.split(/[\s,/]+/).filter((k) => k.length > 2);

      function scoreItem(item: typeof items[0]): number {
        const topicLower = (item.topic ?? "").toLowerCase();
        const tagsLower = (item.tags ?? []).map((t) => t.toLowerCase());
        const questionLower = item.questionText.toLowerCase();
        let score = 0;
        // Exact topic match — highest weight
        if (topicLower === normalizedTopic) score += 8;
        // Topic contains full filter string
        else if (topicLower.includes(normalizedTopic)) score += 4;
        // Any keyword hits topic
        else if (keywords.some((k) => topicLower.includes(k))) score += 2;
        // Tag exact match
        if (tagsLower.some((t) => t === normalizedTopic)) score += 4;
        // Tag partial match per keyword
        score += keywords.filter((k) => tagsLower.some((t) => t.includes(k))).length;
        // Question text contains keywords (weakest signal)
        score += keywords.filter((k) => questionLower.includes(k)).length * 0.5;
        return score;
      }

      items = [...cache.items]
        .map((item) => ({ item, score: scoreItem(item) }))
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item);
      // Keep top 8 most relevant — enough context without token bloat
      items = items.slice(0, 8);
    }

    const lines = items
      .map(
        (item, i) =>
          `--- Example ${i + 1} ---\n` +
          `Question: ${item.questionText}\n` +
          `Command Word: ${item.commandWord} | Marks: ${item.marks}` +
          `${item.questionType ? ` | Type: ${item.questionType}` : ""}` +
          `${item.difficultyBand ? ` | Difficulty: ${item.difficultyBand}` : ""}` +
          `${item.assessmentObjective ? ` | ${item.assessmentObjective}` : ""}` +
          `\n${item.topic ? `Topic: ${item.topic}\n` : ""}` +
          `Mark Scheme:\n${item.markScheme}` +
          (item.tikzCode ? `\nReference Diagram (TikZ):\n\`\`\`tikz\n${item.tikzCode}\n\`\`\`` : ""),
      )
      .join("\n\n");
    return cache.summary?.trim()
      ? `PAPER SUMMARY:\n${cache.summary.trim()}\n\n${lines}`
      : lines;
  }
  return (cache.examples ?? "").trim();
}

function formatSyllabusText(
  topics: Record<string, string>,
  topicFilter?: string,
): string {
  const entries = Object.entries(topics);
  if (!topicFilter) {
    return entries.map(([t, objs]) => `### ${t}\n${objs}`).join("\n\n");
  }

  const normalized = topicFilter.toLowerCase().trim();
  const scored = entries.map(([t, objs]) => {
    let score = 0;
    if (t.toLowerCase().includes(normalized)) score += 10;
    if (objs.toLowerCase().includes(normalized)) score += 2;
    return { t, objs, score };
  });

  const matches = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0)
    return entries.map(([t, objs]) => `### ${t}\n${objs}`).join("\n\n");
  return matches
    .slice(0, 10)
    .map((x) => `### ${x.t}\n${x.objs}`)
    .join("\n\n");
}

async function buildReferences(
  knowledgeBaseResources: Resource[],
  getBase64: (r: Resource) => Promise<string>,
  provider: AIProvider,
  apiKey?: string,
  updateGeminiUri?: (r: Resource, uri: string) => Promise<void>,
  topic?: string,
) {
  return Promise.all(
    knowledgeBaseResources.map(async (r) => {
      // For Gemini: try to use File API URI instead of re-uploading base64 each time
      if (provider === "gemini" && apiKey) {
        const uriAge = r.geminiFileUploadedAt
          ? Date.now() - r.geminiFileUploadedAt.toMillis()
          : Infinity;
        if (r.geminiFileUri && uriAge < GEMINI_URI_VALID_MS) {
          // Valid URI — skip base64 download entirely
          return {
            data: "",
            mimeType: r.mimeType,
            resourceType: r.resourceType,
            name: r.name,
            geminiFileUri: r.geminiFileUri,
            geminiFileUploadedAt: r.geminiFileUploadedAt?.toMillis(),
          };
        }
        // For syllabus: check text cache before downloading the file
        if (r.resourceType === "syllabus") {
          try {
            const cache = await getSyllabusCache(r.id);
            if (cache && Object.keys(cache.topics).length > 0) {
              const syllabusText = formatSyllabusText(cache.topics, topic);
              return {
                data: "",
                mimeType: r.mimeType,
                resourceType: "syllabus",
                name: r.name,
                syllabusText,
              };
            }
          } catch {
            /* fall through to file upload */
          }
        }
        // For past paper: check text cache before downloading the file
        if (r.resourceType === "past_paper") {
          try {
            const cache = await getPastPaperCache(r.id);
            if (cache) {
              const pastPaperText = formatPastPaperText(cache, topic);
              if (pastPaperText.length > 100) {
                return {
                  data: "",
                  mimeType: r.mimeType,
                  resourceType: "past_paper",
                  name: r.name,
                  pastPaperText,
                };
              }
            }
          } catch {
            /* fall through to file upload */
          }
        }
        // URI missing or expired — download, upload to File API, save URI
        try {
          const base64 = await getBase64(r);
          const uri = await uploadToGeminiFileApi(
            base64,
            r.mimeType,
            r.name,
            apiKey,
          );
          await updateGeminiUri?.(r, uri);
          return {
            data: base64,
            mimeType: r.mimeType,
            resourceType: r.resourceType,
            name: r.name,
            geminiFileUri: uri,
            geminiFileUploadedAt: Date.now(),
          };
        } catch {
          // File API failed — fall back to inline base64
          const base64 = await getBase64(r);
          return {
            data: base64,
            mimeType: r.mimeType,
            resourceType: r.resourceType,
            name: r.name,
          };
        }
      }
      // Non-Gemini provider: check text caches first
      if (r.resourceType === "syllabus") {
        try {
          const cache = await getSyllabusCache(r.id);
          if (cache && Object.keys(cache.topics).length > 0) {
            const syllabusText = formatSyllabusText(cache.topics, topic);
            return {
              data: "",
              mimeType: r.mimeType,
              resourceType: "syllabus",
              name: r.name,
              syllabusText,
            };
          }
        } catch {
          /* fall through */
        }
      }
      if (r.resourceType === "past_paper") {
        try {
          const cache = await getPastPaperCache(r.id);
          if (cache) {
            const pastPaperText = formatPastPaperText(cache, topic);
            if (pastPaperText.length > 100) {
              return {
                data: "",
                mimeType: r.mimeType,
                resourceType: "past_paper",
                name: r.name,
                pastPaperText,
              };
            }
          }
        } catch {
          /* fall through */
        }
      }
      const base64 = await getBase64(r);
      return {
        data: base64,
        mimeType: r.mimeType,
        resourceType: r.resourceType,
        name: r.name,
      };
    }),
  );
}

export function useGeneration(
  notify: NotifyFn,
  provider: AIProvider = "gemini",
  apiKey?: string,
  updateGeminiUri?: (r: Resource, uri: string) => Promise<void>,
) {
  const [generatedAssessment, setGeneratedAssessment] =
    useState<Assessment | null>(null);
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<AIError | null>(null);
  const [lastRunCostIDR, setLastRunCostIDR] = useState<number | null>(null);
  const [generationLog, setGenerationLog] = useState<string[]>([]);

  const generate = useCallback(
    async (
      config: GenerationConfig,
      knowledgeBaseResources: Resource[],
      getBase64: (r: Resource) => Promise<string>,
    ) => {
      setIsGenerating(true);
      setIsAuditing(false);
      setRetryCount(0);
      setError(null);
      setLastRunCostIDR(null);
      setGenerationLog([]);
      const addLog = (msg: string) =>
        setGenerationLog((prev) => [...prev, msg]);
      let billedCostIDR = 0;
      const addUsageCost = (
        model: string,
        inputTokens: number,
        outputTokens: number,
      ) => {
        billedCostIDR += estimateCostIDR(model, inputTokens, outputTokens);
      };
      try {
        const refCount = knowledgeBaseResources.length;
        addLog(
          refCount > 0
            ? `Loading ${refCount} reference${refCount > 1 ? "s" : ""} (${knowledgeBaseResources.map((r) => r.name).join(", ")})…`
            : "Preparing generation request…",
        );
        const references = await buildReferences(
          knowledgeBaseResources,
          getBase64,
          provider,
          apiKey,
          updateGeminiUri,
          config.topic,
        );
        addLog(
          `Sending request to ${provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI" : "Anthropic"} AI (${config.count} questions, ${config.difficulty} difficulty)…`,
        );
        const questions = await generateTest(
          {
            ...config,
            type: normalizeGenerationQuestionType(config.type),
            references,
            apiKey,
          },
          (attempt) => {
            setRetryCount(attempt);
            addLog(`Rate limit hit — retrying (${attempt}/3)…`);
            notify(`Rate limit hit, retrying (${attempt}/3)...`, "info");
          },
          addUsageCost,
          addLog,
        );

        const draftQuestions = questions;
        addLog(
          `Generated ${draftQuestions.length} draft question${draftQuestions.length !== 1 ? "s" : ""}…`,
        );

        // Critique & Refine Loop (Eleştir ve İyileştir)
        setIsAuditing(true);
        addLog("Auditing and refining questions (AI Critique)...");

        let finalQuestions = draftQuestions;
        try {
          const tempAssessment: Assessment = {
            id: "temp",
            subject: config.subject,
            topic: config.topic,
            difficulty: config.difficulty,
            questions: draftQuestions,
            userId: "temp",
            createdAt: Timestamp.now(),
          };
          const audited = await aiAudit(
            config.subject,
            tempAssessment,
            config.model,
            provider,
            apiKey,
          );
          if (audited && audited.length > 0) finalQuestions = audited;
          addLog("Audit complete. Questions refined.");
        } catch (err) {
          console.warn("Audit failed, using draft questions", err);
          addLog("Audit skipped (optimization unavailable).");
        }

        addLog("Finalising assessment…");
        const draft: Assessment = {
          id: crypto.randomUUID(),
          subject: config.subject,
          topic: config.topic,
          difficulty: config.difficulty,
          questions: finalQuestions,
          userId: auth.currentUser?.uid ?? "",
          createdAt: Timestamp.now(),
        };
        setGeneratedAssessment(draft);
        if (billedCostIDR > 0) setLastRunCostIDR(Math.round(billedCostIDR));
        notify("Assessment generated successfully!", "success");
      } catch (e: any) {
        const ae = e as AIError;
        setError(ae);
        notify(ae.message ?? "Failed to generate assessment", "error");
      } finally {
        setIsGenerating(false);
        setIsAuditing(false);
      }
    },
    [notify, provider, apiKey],
  );

  const analyzeFile = useCallback(
    async (
      file: { base64: string; mimeType: string },
      subject: string,
      model: string,
      knowledgeBaseResources: Resource[],
      getBase64: (r: Resource) => Promise<string>,
    ) => {
      setIsGenerating(true);
      setError(null);
      try {
        const references = await buildReferences(
          knowledgeBaseResources,
          getBase64,
          provider,
          apiKey,
          updateGeminiUri,
          subject, // Analyze mode implies subject as topic context
        );
        const result: AnalyzeFileResult = await aiAnalyze(
          file.base64,
          file.mimeType,
          subject,
          3,
          model,
          provider,
          references,
          apiKey,
        );
        setAnalysisText(result.analysis);
        setGeneratedAssessment({
          id: crypto.randomUUID(),
          subject,
          topic: "Analyzed Content",
          difficulty: "N/A",
          questions: result.questions,
          userId: auth.currentUser?.uid ?? "",
          createdAt: Timestamp.now(),
        });
        notify("File analyzed successfully!", "success");
      } catch (e: any) {
        const ae = e as AIError;
        setError(ae);
        notify(ae.message ?? "Failed to analyze file", "error");
      } finally {
        setIsGenerating(false);
      }
    },
    [notify, provider, apiKey],
  );

  const getStudentFeedback = useCallback(
    async (studentAnswers: string[], model: string) => {
      if (!generatedAssessment) return;
      try {
        const fb = await aiFeedback(
          generatedAssessment.subject,
          generatedAssessment,
          studentAnswers,
          model,
          provider,
          apiKey,
        );
        notify("Feedback ready", "success");
        return fb;
      } catch {
        notify("Failed to get feedback", "error");
        return null;
      }
    },
    [generatedAssessment, notify, provider, apiKey],
  );

  return {
    generatedAssessment,
    setGeneratedAssessment,
    analysisText,
    isGenerating,
    isAuditing,
    retryCount,
    error,
    setError,
    generate,
    analyzeFile,
    getStudentFeedback,
    lastRunCostIDR,
    generationLog,
  };
}
