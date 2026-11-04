import { browseWorkspace } from "@/lib/search-service";
import { filterKind, pageNumber, parseFilters, SearchInputError } from "@/lib/search-types";
import { privateJson, searchError, searchUser } from "@/lib/search-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await searchUser(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["kind", "filters", "limit", "offset"].includes(key))) throw new SearchInputError("Unknown browse parameter.");
    const kind = filterKind(params.get("kind"));
    const raw = params.get("filters") ?? "{}";
    if (raw.length > 8192) throw new SearchInputError("Too many filters.");
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new SearchInputError("Invalid filter configuration."); }
    const filters = parseFilters(kind, input);
    const limit = pageNumber(params.get("limit"), 60, 100);
    const offset = pageNumber(params.get("offset"), 0, 1_000_000);
    if (!limit) throw new SearchInputError("Limit must be at least 1.");
    return privateJson(await browseWorkspace(user.id, kind, filters, limit, offset));
  } catch (error) { return searchError(error); }
}
