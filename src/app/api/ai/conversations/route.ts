import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { folioAiConversations } from "@/db/schema";
import { getUser, sameOrigin } from "@/lib/auth";
import { SearchInputError } from "@/lib/search-types";
import { aiJson, aiError, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";

export const dynamic = "force-dynamic";
export const TITLE_MAX = 120;

/** Lists the signed-in user's conversations, newest activity first. */
export async function GET() {
  try {
    const user = await getUser();
    await ensureSchema();
    const conversations = await db.select().from(folioAiConversations)
      .where(eq(folioAiConversations.userId, user.id))
      .orderBy(desc(folioAiConversations.lastMessageAt))
      .limit(50);
    return aiJson({ conversations });
  } catch (error) { return aiError(error); }
}

/** Creates a new empty conversation for the signed-in user. */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return aiJson({ error: "Request not allowed." }, 403);
    const user = await requireAIUser(request);
    await ensureSchema();
    const body = await parseSmallJson(request);
    const title = typeof body.title === "string" ? body.title.trim().slice(0, TITLE_MAX) : "";
    const [created] = await db.insert(folioAiConversations).values({
      userId: user.id,
      title: title || "New conversation",
      messageCount: 0,
    }).returning();
    return aiJson({ conversation: created }, 201);
  } catch (error) { return aiError(error); }
}
