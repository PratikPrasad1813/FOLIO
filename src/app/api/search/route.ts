import { globalSearch } from "@/lib/search-service";
import { pageNumber, queryText, searchScope, SearchInputError } from "@/lib/search-types";
import { privateJson, searchError, searchUser } from "@/lib/search-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await searchUser(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["q", "scope", "limit"].includes(key))) throw new SearchInputError("Unknown search parameter.");
    const q = queryText(params.get("q") ?? "");
    const scope = searchScope(params.get("scope") ?? "all");
    const limit = pageNumber(params.get("limit"), scope === "all" ? 6 : 20, 20);
    if (!limit) throw new SearchInputError("Limit must be at least 1.");
    return privateJson(await globalSearch(user.id, q, scope, limit));
  } catch (error) { return searchError(error); }
}
