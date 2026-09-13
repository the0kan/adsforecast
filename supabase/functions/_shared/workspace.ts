import type { User } from "jsr:@supabase/supabase-js@2";
import type { AdminClient } from "./supabase.ts";

type AppUserRow = {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export async function upsertAppUser(admin: AdminClient, authUser: User): Promise<AppUserRow> {
  const email = authUser.email?.trim() || `user-${authUser.id}@users.invalid`;
  const name =
    (authUser.user_metadata?.display_name as string | undefined)?.trim() ||
    email.split("@")[0] ||
    "member";

  const existing = await admin
    .from("app_users")
    .select("*")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (existing.data) return existing.data as AppUserRow;

  const id = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
  const ins = await admin
    .from("app_users")
    .insert({ id, auth_user_id: authUser.id, email, name })
    .select("*")
    .single();

  if (!ins.error && ins.data) return ins.data as AppUserRow;

  const retry = await admin
    .from("app_users")
    .select("*")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  if (retry.data) return retry.data as AppUserRow;

  throw ins.error ?? new Error("app_user_create_failed");
}

export type BootstrapBundle = {
  user: AppUserRow;
  workspace: WorkspaceRow;
  membership: MemberRow;
};

export async function ensureWorkspaceBootstrap(
  admin: AdminClient,
  authUser: User,
): Promise<BootstrapBundle> {
  const appUser = await upsertAppUser(admin, authUser);

  const withWs = await admin
    .from("workspace_members")
    .select(
      "id, workspace_id, user_id, role, created_at, workspaces(id, name, created_at, updated_at)",
    )
    .eq("user_id", appUser.id)
    .limit(1)
    .maybeSingle();

  if (withWs.data?.workspace_id && withWs.data.workspaces) {
    const ws = withWs.data.workspaces as WorkspaceRow;
    return {
      user: appUser,
      workspace: ws,
      membership: {
        id: withWs.data.id,
        workspace_id: withWs.data.workspace_id,
        user_id: withWs.data.user_id,
        role: withWs.data.role,
        created_at: withWs.data.created_at,
      },
    };
  }

  const fallbackName = appUser.name || appUser.email.split("@")[0] || "member";
  const wsId = `ws_${crypto.randomUUID().replace(/-/g, "")}`;
  const wsIns = await admin
    .from("workspaces")
    .insert({ id: wsId, name: `${fallbackName}'s workspace` })
    .select("*")
    .single();

  if (wsIns.error || !wsIns.data) throw wsIns.error ?? new Error("workspace_create_failed");

  const mId = `wsm_${crypto.randomUUID().replace(/-/g, "")}`;
  const memIns = await admin
    .from("workspace_members")
    .insert({
      id: mId,
      workspace_id: wsId,
      user_id: appUser.id,
      role: "owner",
    })
    .select("*")
    .single();

  if (memIns.error || !memIns.data) throw memIns.error ?? new Error("workspace_member_create_failed");

  return {
    user: appUser,
    workspace: wsIns.data as WorkspaceRow,
    membership: memIns.data as MemberRow,
  };
}

export async function getWorkspaceIdForAuthUser(
  admin: AdminClient,
  authUser: User,
): Promise<string> {
  const { workspace } = await ensureWorkspaceBootstrap(admin, authUser);
  return workspace.id;
}

/** Verify JWT user owns this workspace via membership. */
export async function assertWorkspaceAccess(
  admin: AdminClient,
  authUser: User,
  workspaceId: string,
): Promise<boolean> {
  const appUser = await upsertAppUser(admin, authUser);
  const m = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", appUser.id)
    .maybeSingle();
  return Boolean(m.data?.id);
}
