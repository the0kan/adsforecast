import { handleOptions } from "../_shared/cors.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";
import { enumField, inputErrorResponse, readJsonObject, textField } from "../_shared/validation.ts";

const ACTIONS = ["create_ticket", "reply_ticket"] as const;
const CATEGORIES = ["product", "meta", "billing", "account", "bug", "feedback", "other"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (!["GET", "POST"].includes(req.method)) return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const ticketId = (url.searchParams.get("ticketId") || "").trim();
      const tickets = await auth.admin
        .from("support_tickets")
        .select("id,subject,category,priority,status,last_activity_at,resolved_at,created_at,updated_at")
        .eq("workspace_id", bundle.workspace.id)
        .order("last_activity_at", { ascending: false })
        .limit(100);
      if (tickets.error) return jsonError(500, "TICKETS_LOAD_FAILED", "Could not load support tickets.");

      let selected = null;
      let messages: unknown[] = [];
      if (ticketId) {
        selected = tickets.data?.find((ticket) => ticket.id === ticketId) || null;
        if (!selected) return jsonError(404, "TICKET_NOT_FOUND", "Support ticket was not found in this workspace.");
        const thread = await auth.admin
          .from("support_ticket_messages")
          .select("id,author_kind,body,created_at")
          .eq("ticket_id", ticketId)
          .eq("is_internal", false)
          .order("created_at", { ascending: true })
          .limit(250);
        if (thread.error) return jsonError(500, "TICKET_THREAD_FAILED", "Could not load the ticket conversation.");
        messages = thread.data || [];
      }
      return jsonOk({ success: true, tickets: tickets.data || [], selected, messages });
    }

    const body = await readJsonObject(req);
    const action = enumField(body.action, ACTIONS, "Action");
    const now = new Date().toISOString();

    if (action === "create_ticket") {
      const recent = await auth.admin
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("created_by", bundle.user.id)
        .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
      if (recent.error) return jsonError(500, "TICKET_RATE_CHECK_FAILED", "Could not validate the support request.");
      if ((recent.count || 0) >= 5) return jsonError(429, "TICKET_RATE_LIMITED", "Too many new tickets. Please wait before opening another.");

      const ticket = await auth.admin.from("support_tickets").insert({
        workspace_id: bundle.workspace.id,
        created_by: bundle.user.id,
        subject: textField(body.subject, "Subject", { min: 5, max: 160, required: true }),
        category: enumField(body.category || "product", CATEGORIES, "Category"),
        priority: enumField(body.priority || "normal", PRIORITIES, "Priority"),
        status: "open",
        last_activity_at: now,
      }).select("id,subject,category,priority,status,last_activity_at,created_at,updated_at").single();
      if (ticket.error || !ticket.data) return jsonError(500, "TICKET_CREATE_FAILED", "Could not create the support ticket.");

      const message = await auth.admin.from("support_ticket_messages").insert({
        ticket_id: ticket.data.id,
        author_user_id: bundle.user.id,
        author_kind: "customer",
        body: textField(body.message, "Message", { min: 10, max: 5000, required: true }),
      });
      if (message.error) {
        await auth.admin.from("support_tickets").delete().eq("id", ticket.data.id).eq("workspace_id", bundle.workspace.id);
        return jsonError(500, "TICKET_CREATE_FAILED", "Could not save the support message.");
      }
      return jsonOk({ success: true, ticket: ticket.data }, 201);
    }

    const ticketId = textField(body.ticketId, "Ticket", { min: 8, max: 80, required: true });
    const ticket = await auth.admin
      .from("support_tickets")
      .select("id,status")
      .eq("id", ticketId)
      .eq("workspace_id", bundle.workspace.id)
      .maybeSingle();
    if (ticket.error) return jsonError(500, "TICKET_LOAD_FAILED", "Could not validate the support ticket.");
    if (!ticket.data) return jsonError(404, "TICKET_NOT_FOUND", "Support ticket was not found in this workspace.");
    if (ticket.data.status === "closed") return jsonError(409, "TICKET_CLOSED", "Closed tickets cannot receive new replies. Open a new ticket instead.");

    const reply = await auth.admin.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      author_user_id: bundle.user.id,
      author_kind: "customer",
      body: textField(body.message, "Message", { min: 2, max: 5000, required: true }),
    });
    if (reply.error) return jsonError(500, "TICKET_REPLY_FAILED", "Could not send the ticket reply.");
    const updated = await auth.admin.from("support_tickets").update({
      status: ticket.data.status === "waiting_customer" ? "open" : ticket.data.status,
      last_activity_at: now,
      updated_at: now,
    }).eq("id", ticketId).eq("workspace_id", bundle.workspace.id);
    if (updated.error) return jsonError(500, "TICKET_REPLY_FAILED", "The reply was saved but ticket state could not be updated.");
    return jsonOk({ success: true });
  } catch (error) {
    const input = inputErrorResponse(error, jsonError);
    if (input) return input;
    return jsonError(500, "INTERNAL_ERROR", "Could not complete the support request.");
  }
});

