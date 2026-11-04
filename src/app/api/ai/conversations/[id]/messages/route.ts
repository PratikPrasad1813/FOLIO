import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { folioAiConversations, folioAiMessages } from "@/db/schema";
import { getUser, sameOrigin } from "@/lib/auth";
import { SearchInputError } from "@/lib/search-types";
import { aiJson, aiError, parseSmallJson } from "@/lib/folio-ai/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_MAX = 64_000;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IncomingMessage {
  id?: string | null;
  role: string;
  content: string;
  generationId?: string | null;
  generationStatus?: string | null;
  plan?: unknown;
  results?: unknown;
}

function validateMessage(raw: unknown, index: number): IncomingMessage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SearchInputError(`Message ${index + 1} is invalid.`);
  }
  const entry = raw as Record<string, unknown>;
  if (entry.role !== "user" && entry.role !== "assistant") {
    throw new SearchInputError(`Message ${index + 1} must be from the user or the assistant.`);
  }
  if (typeof entry.content !== "string" || entry.content.length > CONTENT_MAX) {
    throw new SearchInputError(`Message ${index + 1} content is missing or too long.`);
  }
  const message: IncomingMessage = { role: entry.role, content: entry.content };
  if (entry.id !== undefined && entry.id !== null) {
    if (typeof entry.id !== "string" || !UUID_TEXT.test(entry.id)) {
      throw new SearchInputError("Invalid message identifier.");
    }
    message.id = entry.id;
  }
  if (entry.generationId !== undefined && entry.generationId !== null) {
    if (typeof entry.generationId !== "string" || !UUID_TEXT.test(entry.generationId)) {
      throw new SearchInputError("Invalid generation identifier.");
    }
    // Only assistant messages bind to the unique (userId, generationId) index so
    // the user prompt and assistant response for the same generation never collide.
    message.generationId = entry.role === "assistant" ? entry.generationId : null;
  }
  if (entry.generationStatus !== undefined && entry.generationStatus !== null) {
    if (!["complete", "cancelled", "error"].includes(String(entry.generationStatus))) {
      throw new SearchInputError("Invalid generation status.");
    }
    message.generationStatus = String(entry.generationStatus);
  }
  if (entry.plan !== undefined && entry.plan !== null) {
    if (typeof entry.plan !== "object" || Array.isArray(entry.plan)) throw new SearchInputError("Invalid action plan.");
    message.plan = entry.plan;
  }
  if (entry.results !== undefined && entry.results !== null) {
    if (!Array.isArray(entry.results) || entry.results.length > 25) throw new SearchInputError("Invalid action results.");
    message.results = entry.results;
  }
  return message;
}

/** Derives a readable title from the first user message. */
function deriveTitle(messages: { role: string; content: string }[]): string {
  const first = messages.find(message => message.role === "user")?.content ?? "";
  const clean = first.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

/**
 * Appends or updates messages in a conversation the caller owns.
 * Supports idempotent retries and intermediate/final assistant message updates.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return aiJson({ error: "Request not allowed." }, 403);
    const user = await getUser();
    await ensureSchema();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid conversation ID.");

    const body = await parseSmallJson(request, 200_000);
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 20) {
      throw new SearchInputError("Provide 1–20 messages to save.");
    }
    const messages = body.messages.map(validateMessage);

    const result = await db.transaction(async tx => {
      const [conversation] = await tx.select().from(folioAiConversations)
        .where(and(eq(folioAiConversations.id, id), eq(folioAiConversations.userId, user.id)))
        .for("update").limit(1);
      if (!conversation) throw new SearchInputError("Conversation not found.", 404);

      const saved: (typeof folioAiMessages.$inferSelect)[] = [];
      let newCount = 0;

      for (const message of messages) {
        if (message.role === "assistant" && message.generationId) {
          const [existing] = await tx.select().from(folioAiMessages)
            .where(and(eq(folioAiMessages.userId, user.id), eq(folioAiMessages.generationId, message.generationId)))
            .limit(1);
          if (existing) {
            const [updated] = await tx.update(folioAiMessages)
              .set({
                content: message.content || existing.content,
                generationStatus: message.generationStatus ?? existing.generationStatus,
                plan: message.plan !== undefined ? message.plan : existing.plan,
                results: message.results !== undefined ? message.results : existing.results,
              })
              .where(eq(folioAiMessages.id, existing.id))
              .returning();
            if (updated) saved.push(updated);
            continue;
          }
        }

        if (message.id) {
          const [existingById] = await tx.select().from(folioAiMessages)
            .where(and(eq(folioAiMessages.id, message.id), eq(folioAiMessages.userId, user.id)))
            .limit(1);
          if (existingById) {
            const [updatedById] = await tx.update(folioAiMessages)
              .set({
                content: message.content || existingById.content,
                generationStatus: message.generationStatus ?? existingById.generationStatus,
                plan: message.plan !== undefined ? message.plan : existingById.plan,
                results: message.results !== undefined ? message.results : existingById.results,
              })
              .where(eq(folioAiMessages.id, existingById.id))
              .returning();
            if (updatedById) saved.push(updatedById);
            continue;
          }
        }

        const [inserted] = await tx.insert(folioAiMessages).values({
          ...(message.id ? { id: message.id } : {}),
          userId: user.id,
          conversationId: id,
          role: message.role,
          content: message.content,
          generationId: message.generationId ?? null,
          generationStatus: message.generationStatus ?? null,
          plan: message.plan ?? null,
          results: message.results ?? null,
        }).onConflictDoNothing().returning();

        if (inserted) {
          saved.push(inserted);
          newCount++;
        }
      }

      if (saved.length) {
        const lastMessageAt = new Date();
        const autoTitle = conversation.title === "New conversation" ? deriveTitle(messages) : conversation.title;
        await tx.update(folioAiConversations)
          .set({
            title: autoTitle,
            messageCount: conversation.messageCount + newCount,
            lastMessageAt,
            updatedAt: lastMessageAt,
          })
          .where(eq(folioAiConversations.id, id));
        return { inserted: saved, conversation: { ...conversation, title: autoTitle, messageCount: conversation.messageCount + newCount, lastMessageAt } };
      }
      return { inserted: saved, conversation };
    });

    return aiJson({ inserted: result.inserted, conversation: result.conversation }, 201);
  } catch (error) { return aiError(error); }
}
