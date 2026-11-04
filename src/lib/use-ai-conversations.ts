"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIActionResult, AITaskRecord } from "@/lib/folio-ai/types";
import { searchRequest, jsonRequest } from "@/lib/search-client";

const ACTIVE_CONVERSATION_KEY = "folio.ai.activeConversationId";

export interface AiConversation {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiPersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  generationId: string | null;
  generationStatus: string | null;
  plan: { actions: { id: string; params: Record<string, unknown> }[] } | null;
  results: AIActionResult[] | null;
  createdAt: string;
}

interface ConversationsResponse { conversations: AiConversation[] }
export interface ConversationResponse {
  conversation: AiConversation;
  messages: AiPersistedMessage[];
  tasks?: AITaskRecord[];
}

function readStoredConversationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function writeStoredConversationId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // sessionStorage is optional
  }
}

/**
 * Persistent AI conversation history backed by Neon PostgreSQL.
 * Every request is authenticated and scoped to the signed-in Folio user; the
 * server enforces ownership, so client state is only a cache.
 */
export function useAiConversations() {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(() => readStoredConversationId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const setActiveId = useCallback((next: string | null | ((prev: string | null) => string | null)) => {
    setActiveIdState(prev => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeStoredConversationId(resolved);
      return resolved;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const body = await searchRequest<ConversationsResponse>("/api/ai/conversations");
      if (!mounted.current) return;
      setConversations(prev => {
        const fetchedIds = new Set(body.conversations.map(c => c.id));
        const localNew = prev.filter(c => !fetchedIds.has(c.id));
        return [...localNew, ...body.conversations];
      });
      setError("");
      setActiveId(current => {
        const stored = current || readStoredConversationId();
        if (stored) return stored;
        return body.conversations[0]?.id ?? null;
      });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t load conversations.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [setActiveId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Creates a new empty conversation and makes it active. */
  const create = useCallback(async (title?: string): Promise<AiConversation | null> => {
    try {
      const body = await searchRequest<{ conversation: AiConversation }>(
        "/api/ai/conversations",
        jsonRequest("POST", title ? { title } : {}),
      );
      if (!mounted.current) return null;
      setConversations(current => [body.conversation, ...current.filter(c => c.id !== body.conversation.id)]);
      setActiveId(body.conversation.id);
      return body.conversation;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t start a new conversation.");
      return null;
    }
  }, [setActiveId]);

  const upsertConversation = useCallback((conversation: AiConversation) => {
    if (!mounted.current) return;
    setConversations(current => {
      const rest = current.filter(c => c.id !== conversation.id);
      return [conversation, ...rest];
    });
    setActiveId(conversation.id);
  }, [setActiveId]);

  const load = useCallback(async (id: string, interruptedTaskIds: string[] = []): Promise<ConversationResponse | null> => {
    try {
      const query = interruptedTaskIds.length
        ? `?interrupted=${encodeURIComponent(interruptedTaskIds.join(","))}`
        : "";
      const body = await searchRequest<ConversationResponse>(`/api/ai/conversations/${id}${query}`);
      if (!mounted.current) return null;
      setConversations(current => {
        const rest = current.filter(c => c.id !== id);
        return [body.conversation, ...rest];
      });
      setActiveId(id);
      return body;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t open that conversation.");
      return null;
    }
  }, [setActiveId]);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      const body = await searchRequest<{ conversation: AiConversation }>(
        `/api/ai/conversations/${id}`,
        jsonRequest("PATCH", { title }),
      );
      if (!mounted.current) return;
      setConversations(current => current.map(c => (c.id === id ? body.conversation : c)));
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t rename that conversation.");
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await searchRequest(`/api/ai/conversations?id=${id}`, { method: "DELETE" });
      if (!mounted.current) return;
      setConversations(current => {
        const next = current.filter(c => c.id !== id);
        setActiveId(active => (active === id ? next[0]?.id ?? null : active));
        return next;
      });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t delete that conversation.");
    }
  }, [setActiveId]);

  /**
   * Persists messages. Idempotent via generationId/id: a retried generation
   * updates the already-saved rows instead of duplicating them.
   */
  const append = useCallback(
    async (
      conversationId: string,
      messages: {
        id?: string | null;
        role: "user" | "assistant";
        content: string;
        generationId?: string | null;
        generationStatus?: string | null;
        plan?: unknown;
        results?: unknown;
      }[],
    ): Promise<AiConversation | null> => {
      try {
        const body = await searchRequest<{ conversation: AiConversation }>(
          `/api/ai/conversations/${conversationId}/messages`,
          jsonRequest("POST", { messages }),
        );
        if (!mounted.current) return null;
        setConversations(current => current.map(c => (c.id === conversationId ? body.conversation : c)));
        return body.conversation;
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : "Couldn’t save that message.");
        return null;
      }
    },
    [],
  );

  return {
    conversations,
    activeId,
    setActiveId,
    upsertConversation,
    loading,
    error,
    refresh,
    create,
    load,
    rename,
    remove,
    append,
  };
}
