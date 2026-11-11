import { AuthenticationError, getUser, sameOrigin } from "@/lib/auth";
import { readProfile, updateProfile } from "@/lib/profile-service";
import { syncUser, corsJson, desktopCorsPreflight } from "@/lib/sync-auth";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

/** CORS preflight for the desktop shell (its engine PATCHes the profile cross-origin). */
export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function GET(request: Request) {
  try {
    const user = await syncUser(request);
    if (!user) return json({ error: "Please sign in again." }, 401);
    return json(await readProfile(user));
  }
  catch (error) { return json({ error: error instanceof AuthenticationError ? error.message : "Your profile is temporarily unavailable." }, error instanceof AuthenticationError ? 401 : 503); }
}
export async function PATCH(request: Request) {
  try {
    // Dual auth: the web's cookie session OR the desktop shell's Bearer
    // token (the sync engine pushes offline settings changes this way).
    // syncUser applies the same-origin check to the cookie path itself.
    const user = await syncUser(request);
    if (!user) return corsJson(request, { error: "Please sign in again." }, 401);
    const text = await request.text();
    if (text.length > 8192) return corsJson(request, { error: "Profile update is too large." }, 413);
    let body: unknown; try { body = JSON.parse(text); } catch { return corsJson(request, { error: "Please send valid JSON." }, 400); }
    try { return corsJson(request, await updateProfile(user.id, body)); }
    catch (error) {
      if (error instanceof Error && !error.message.includes("query") && error.message.length < 180) return corsJson(request, { error: error.message }, 400);
      return corsJson(request, { error: "Couldn’t save your preferences. Please try again." }, 500);
    }
  } catch (error) { return corsJson(request, { error: error instanceof AuthenticationError ? error.message : "Couldn’t save your preferences." }, error instanceof AuthenticationError ? 401 : 500); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  try {
    const user = await getUser();
    const { deleteUserAccount, DeletionAuthError, DeletionInputError } = await import("@/lib/account-deletion");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const result = await deleteUserAccount({
        user,
        confirmation: body.confirmation,
        password: body.password,
      });
      return json(result, 200);
    } catch (err) {
      if (err instanceof DeletionAuthError) return json({ error: err.message }, 401);
      if (err instanceof DeletionInputError) return json({ error: err.message }, 400);
      return json({ error: "Could not delete account. Please try again." }, 500);
    }
  } catch (error) {
    return json({ error: error instanceof AuthenticationError ? error.message : "Please sign in to delete your account." }, error instanceof AuthenticationError ? 401 : 500);
  }
}
