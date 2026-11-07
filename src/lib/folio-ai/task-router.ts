import {
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_MODELS,
  type LocalModelCategory,
  type LocalModelSpec,
} from "@/lib/folio-ai/model-catalog";

export type PromptComplexity = "low" | "high";
export type PromptRouteReason = "technical" | "strategic" | "quick-action" | "general";

export interface TaskRoute {
  model: LocalModelSpec;
  complexity: PromptComplexity;
  reason: PromptRouteReason;
  rationale: string;
}

const TECHNICAL_TERMS =
  /\b(api|auth|authentication|backend|bug|ci\/cd|code|database|devops|docker|endpoint|engineering|frontend|github|migration|postgres|refactor|schema|software|sql|typescript|webhook)\b/i;
const STRATEGIC_TERMS =
  /\b(analy[sz]e|break\s*down|launch|long[- ]term|milestone|plan|quarter|roadmap|rollout|sprint|strategy|strategic|three[- ]month|timeline)\b/i;
const QUICK_ACTION_TERMS =
  /\b(add (?:a )?(?:priority|tag|label)|assign (?:a )?priority|clean(?: up)?(?: this)? title|complete task|mark (?:this|it) (?:as )?(?:done|complete)|rename(?: this)? title|set (?:a )?(?:deadline|due date|priority)|tag (?:this|it|task)|update (?:the )?(?:title|priority|deadline))\b/i;

function isHighComplexity(prompt: string): boolean {
  const sentences = prompt.split(/[.!?]+/).filter(sentence => sentence.trim()).length;
  const listItems = (prompt.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g) ?? []).length;
  return prompt.length >= 220 || sentences >= 3 || listItems >= 3;
}

export function assessPromptComplexity(prompt: string): PromptComplexity {
  return isHighComplexity(prompt.trim()) || STRATEGIC_TERMS.test(prompt)
    ? "high"
    : "low";
}

function modelForCategory(category: LocalModelCategory): LocalModelSpec {
  const model = Object.values(LOCAL_MODELS).find(candidate => candidate.category === category);
  if (!model) throw new Error(`No local model is configured for the "${category}" category.`);
  return model;
}

export function routeTaskPrompt(prompt: string): TaskRoute {
  const normalized = prompt.trim();
  if (!normalized) {
    const model = LOCAL_MODELS[DEFAULT_LOCAL_MODEL_ID];
    return { model, complexity: "low", reason: "general", rationale: "Using the default structured model." };
  }

  const complexity = assessPromptComplexity(normalized);
  if (TECHNICAL_TERMS.test(normalized)) {
    return {
      model: modelForCategory("coder"),
      complexity,
      reason: "technical",
      rationale: "Technical and engineering language is best matched to the coding specialist.",
    };
  }
  if (STRATEGIC_TERMS.test(normalized) || complexity === "high") {
    return {
      model: modelForCategory("reasoning"),
      complexity: "high",
      reason: "strategic",
      rationale: "This request appears to need multi-step planning and decomposition.",
    };
  }
  if (QUICK_ACTION_TERMS.test(normalized) && normalized.length < 120) {
    return {
      model: modelForCategory("fast"),
      complexity: "low",
      reason: "quick-action",
      rationale: "This is a short workspace action, so a fast model is preferred.",
    };
  }
  const model = LOCAL_MODELS[DEFAULT_LOCAL_MODEL_ID];
  return {
    model,
    complexity,
    reason: "general",
    rationale: "The structured workhorse is the best general-purpose fit.",
  };
}
