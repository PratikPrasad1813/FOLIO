"use client";

import { useState } from "react";
import { Check, ChevronDown, Download, Sparkles } from "lucide-react";
import {
  LOCAL_MODEL_LIST,
  type LocalModelCategory,
  type LocalModelSpec,
} from "@/lib/folio-ai/model-catalog";

const CATEGORY_LABELS: Record<LocalModelCategory, string> = {
  fast: "⚡ Speed",
  structured: "🎯 Structured workhorse",
  reasoning: "🧠 Deep thinker",
  coder: "💻 Engineering",
  creative: "💡 Creative",
};

export interface FolioAIModelSelectorProps {
  selectedModelId: string;
  autoRoute: boolean;
  downloadedModelIds?: ReadonlySet<string>;
  busy?: boolean;
  onSelectModel: (model: LocalModelSpec) => void;
  onAutoRouteChange: (enabled: boolean) => void;
}

export function FolioAIModelSelector({
  selectedModelId,
  autoRoute,
  downloadedModelIds = new Set<string>(),
  busy = false,
  onSelectModel,
  onAutoRouteChange,
}: FolioAIModelSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedModel =
    LOCAL_MODEL_LIST.find(model => model.id === selectedModelId) ?? LOCAL_MODEL_LIST[0];

  return (
    <div className="fa-local-model-selector">
      <label className="fa-settings-field">
        <span>Model routing</span>
        <span className="fa-local-route-toggle">
          <input
            type="checkbox"
            checked={autoRoute}
            disabled={busy}
            onChange={event => onAutoRouteChange(event.target.checked)}
          />
          <Sparkles size={14} />
          Smart auto-route by prompt
        </span>
      </label>

      <div className="fa-local-model-current">
        <div>
          <small>{autoRoute ? "Default / automatic fallback" : "Selected model"}</small>
          <strong>{selectedModel.name}</strong>
          <span>{selectedModel.tagline}</span>
        </div>
        <button
          type="button"
          className="pj-btn is-secondary is-sm"
          aria-expanded={expanded}
          aria-controls="fa-local-model-options"
          disabled={busy}
          onClick={() => setExpanded(value => !value)}
        >
          Choose <ChevronDown size={13} />
        </button>
      </div>

      {expanded && (
        <div id="fa-local-model-options" className="fa-local-model-options" role="list">
          {LOCAL_MODEL_LIST.map(model => {
            const selected = model.id === selectedModel.id;
            const cached = downloadedModelIds.has(model.webLlmModelId);
            return (
              <button
                type="button"
                key={model.id}
                className={`fa-local-model-option${selected ? " is-selected" : ""}`}
                disabled={busy}
                onClick={() => {
                  onSelectModel(model);
                  setExpanded(false);
                }}
              >
                <span className="fa-local-model-option-title">
                  <strong>{model.name}</strong>
                  {selected && <Check size={14} aria-label="Selected" />}
                </span>
                <span>{CATEGORY_LABELS[model.category]} · {model.sizeDisplay} · {model.minRamGb}+ GB RAM suggested</span>
                <small>{model.tagline}</small>
                <span className="fa-local-model-cache">
                  {cached ? <><Check size={12} /> Downloaded · cached locally</> : <><Download size={12} /> Download model · {model.sizeDisplay}</>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="fa-local-model-note">
        Models run in this browser using WebGPU. Downloads are cached by WebLLM; browser storage may be cleared by your device.
      </p>
    </div>
  );
}
