import { AuthenticationError, allowAuthAttempt, getUser, sameOrigin } from "@/lib/auth";
import {
  deleteUserAccount,
  DeletionAuthError,
  DeletionInputError,
} from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }

  let user;
  try {
    user = await getUser();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AuthenticationError
            ? error.message
            : "Please sign in to delete your account.",
        code: "unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    if (!await allowAuthAttempt(request, "account-deletion", user.email)) {
      return Response.json(
        { error: "Too many deletion attempts. Please wait 15 minutes before trying again." },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return Response.json(
        { error: "Please provide a valid deletion request with confirmation." },
        { status: 400 },
      );
    }

    const result = await deleteUserAccount({
      user,
      confirmation: body.confirmation,
      password: body.password,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DeletionAuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof DeletionInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Account deletion failed:", error instanceof Error ? error.name : "Error");
    return Response.json(
      { error: "Could not complete account deletion right now. Please try again." },
      { status: 500 },
    );
  }
}
