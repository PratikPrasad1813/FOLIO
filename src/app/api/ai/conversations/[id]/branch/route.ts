import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { folioAiConversations, folioAiMessages } from "@/db/schema";
import { getUser, sameOrigin } from "@/lib/auth";
import { SearchInputError } from "@/lib/search-types";
import { aiJson, aiError } from "@/lib/folio-ai/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TITLE_MAX = 120;

/** Creates an independent conversation with a copy of the selected transcript. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return aiJson({ error: "Request not allowed." }, 403);
    const user = await getUser();
    await ensureSchema();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid conversation ID.");

    const conversation = await db.transaction(async tx => {
      const [source] = await tx.select().from(folioAiConversations)
        .where(and(eq(folioAiConversations.id, id), eq(folioAiConversations.userId, user.id)))
        .for("update").limit(1);
      if (!source) throw new SearchInputError("Conversation not found.", 404);

      const messages = await tx.select().from(folioAiMessages)
        .where(and(eq(folioAiMessages.conversationId, id), eq(folioAiMessages.userId, user.id)))
        .orderBy(asc(folioAiMessages.createdAt))
        .limit(500);
      const now = new Date();
      const [branch] = await tx.insert(folioAiConversations).values({
        userId: user.id,
        title: `Branch: ${source.title}`.slice(0, TITLE_MAX),
        messageCount: messages.length,
        lastMessageAt: now,
        updatedAt: now,
      }).returning();

      if (messages.length) {
        await tx.insert(folioAiMessages).values(messages.map(message => ({
          userId: user.id,
          conversationId: branch.id,
          role: message.role,
          content: message.content,
          generationId: null,
          generationStatus: message.generationStatus,
          plan: message.plan,
          results: message.results,
          createdAt: message.createdAt,
        })));
      }

      return branch;
    });

    return aiJson({ conversation });
  } catch (error) {
    return aiError(error);
  }
}
