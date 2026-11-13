import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { folioAiConversations, folioAiMessages } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";
import { SearchInputError } from "@/lib/search-types";
import { aiJson, aiError, parseSmallJson } from "@/lib/folio-ai/http";
import { listConversationTasks } from "@/lib/folio-ai/tasks-service";
import { TITLE_MAX } from "../route";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Loads one conversation with its messages and tasks. Ownership is enforced server-side. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid conversation ID.");
    const [conversation] = await db.select().from(folioAiConversations)
      .where(and(eq(folioAiConversations.id, id), eq(folioAiConversations.userId, user.id)))
      .limit(1);
    if (!conversation) throw new SearchInputError("Conversation not found.", 404);

    const url = new URL(request.url);
    const interruptedParam = url.searchParams.get("interrupted") || "";
    const interruptTaskIds = interruptedParam
      .split(",")
      .map(s => s.trim())
      .filter(tid => UUID.test(tid));

    const tasks = await listConversationTasks(user.id, id, { interruptTaskIds });
    const messages = await db.select().from(folioAiMessages)
      .where(and(eq(folioAiMessages.conversationId, id), eq(folioAiMessages.userId, user.id)))
      .orderBy(asc(folioAiMessages.createdAt))
      .limit(500);
    return aiJson({ conversation, messages, tasks });
  } catch (error) { return aiError(error); }
}

/** Renames a conversation. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return aiJson({ error: "Request not allowed." }, 403);
    const user = await requireUser();
    await ensureSchema();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid conversation ID.");
    const body = await parseSmallJson(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > TITLE_MAX) throw new SearchInputError("Enter a conversation name of 1–120 characters.");
    const [updated] = await db.update(folioAiConversations)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(folioAiConversations.id, id), eq(folioAiConversations.userId, user.id)))
      .returning();
    if (!updated) throw new SearchInputError("Conversation not found.", 404);
    return aiJson({ conversation: updated });
  } catch (error) { return aiError(error); }
}

/** Deletes a conversation and all of its messages. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return aiJson({ error: "Request not allowed." }, 403);
    const user = await requireUser();
    await ensureSchema();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid conversation ID.");
    const [removed] = await db.delete(folioAiConversations)
      .where(and(eq(folioAiConversations.id, id), eq(folioAiConversations.userId, user.id)))
      .returning({ id: folioAiConversations.id });
    if (!removed) throw new SearchInputError("Conversation not found.", 404);
    return aiJson({ deleted: true });
  } catch (error) { return aiError(error); }
}
