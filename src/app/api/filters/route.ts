import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { privateJson, readSearchBody, searchError, searchUser } from "@/lib/search-http";
import { filterKind, parseFilters, savedName, SearchInputError, UUID_PATTERN } from "@/lib/search-types";

export const dynamic = "force-dynamic";
const columns = { id: savedFilters.id, kind: savedFilters.kind, name: savedFilters.name, config: savedFilters.config, createdAt: savedFilters.createdAt };
export async function GET(request: Request) {
  try {
    const user = await searchUser(request);
    const kind = filterKind(new URL(request.url).searchParams.get("kind"));
    const filters = await db.select(columns).from(savedFilters).where(and(eq(savedFilters.userId, user.id), eq(savedFilters.kind, kind))).orderBy(desc(savedFilters.createdAt), savedFilters.id).limit(30);
    return privateJson({ filters });
  } catch (error) { return searchError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await searchUser(request);
    const body = await readSearchBody(request);
    const kind = filterKind(body.kind);
    const name = savedName(body.name);
    const config = parseFilters(kind, body.config);
    const filter = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 42))`);
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(savedFilters).where(and(eq(savedFilters.userId, user.id), eq(savedFilters.kind, kind)));
      if (total >= 30) throw new SearchInputError("You can save up to 30 filters per page. Remove one to make room.", 409);
      const [created] = await tx.insert(savedFilters).values({ userId: user.id, kind, name, nameKey: name.toLowerCase(), config }).onConflictDoNothing().returning(columns);
      if (!created) throw new SearchInputError("You already have a saved filter with this name.", 409);
      return created;
    });
    return privateJson({ filter }, 201);
  } catch (error) { return searchError(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await searchUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !UUID_PATTERN.test(id)) throw new SearchInputError("Invalid saved filter ID.");
    const [removed] = await db.delete(savedFilters).where(and(eq(savedFilters.userId, user.id), eq(savedFilters.id, id))).returning({ id: savedFilters.id });
    if (!removed) throw new SearchInputError("Saved filter not found.", 404);
    return privateJson({ deleted: true });
  } catch (error) { return searchError(error); }
}
