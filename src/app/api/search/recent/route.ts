import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { recentSearches } from "@/db/schema";
import { privateJson, readSearchBody, searchError, searchUser } from "@/lib/search-http";
import { queryText, searchScope, SearchInputError, UUID_PATTERN } from "@/lib/search-types";

export const dynamic = "force-dynamic";
const columns = { id: recentSearches.id, query: recentSearches.query, scope: recentSearches.scope, lastUsedAt: recentSearches.lastUsedAt };
export async function GET(request: Request) {
  try {
    const user = await searchUser(request);
    return privateJson({ searches: await db.select(columns).from(recentSearches).where(eq(recentSearches.userId, user.id)).orderBy(desc(recentSearches.lastUsedAt), asc(recentSearches.id)).limit(8) });
  } catch (error) { return searchError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await searchUser(request);
    const body = await readSearchBody(request);
    const query = queryText(body.query);
    const scope = searchScope(body.scope ?? "all");
    if (!query) throw new SearchInputError("Enter a search to remember.");
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 41))`);
      await tx.insert(recentSearches).values({ userId: user.id, query, queryKey: query.toLowerCase(), scope })
        .onConflictDoUpdate({ target: [recentSearches.userId, recentSearches.queryKey, recentSearches.scope], set: { query, lastUsedAt: new Date() } });
      const keep = await tx.select({ id: recentSearches.id }).from(recentSearches).where(eq(recentSearches.userId, user.id)).orderBy(desc(recentSearches.lastUsedAt), asc(recentSearches.id)).limit(8);
      await tx.delete(recentSearches).where(and(eq(recentSearches.userId, user.id), notInArray(recentSearches.id, keep.map(row => row.id))));
    });
    return privateJson({ saved: true });
  } catch (error) { return searchError(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await searchUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null && !UUID_PATTERN.test(id)) throw new SearchInputError("Invalid search ID.");
    const removed = await db.delete(recentSearches).where(and(eq(recentSearches.userId, user.id), id ? eq(recentSearches.id, id) : undefined)).returning({ id: recentSearches.id });
    if (id && !removed.length) throw new SearchInputError("Search not found.", 404);
    return privateJson({ deleted: removed.length });
  } catch (error) { return searchError(error); }
}
