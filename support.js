import { fetchSupportCenter, updateSupportCenter } from "./app-account.js?v=1";
import { initAppPage, setTopbarIdentity, wireCommonShell } from "./app-shell.js?v=10";

let demo = false;
let tickets = [];
let selectedId = "";

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const formatDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

function setFeedback(message, tone = "") {
  const node = document.getElementById("support-feedback");
  if (!node) return;
  node.textContent = message;
  node.className = `launch-feedback${tone ? ` launch-feedback--${tone}` : ""}`;
}

function renderList() {
  const mount = document.getElementById("support-ticket-list");
  if (!mount) return;
  if (!tickets.length) {
    mount.innerHTML = '<div class="support-ticket-list__empty"><strong>No tickets yet</strong><p>Open a ticket when you need help from the team.</p></div>';
    return;
  }
  mount.innerHTML = tickets.map((ticket) => `<button type="button" class="support-ticket-item${ticket.id === selectedId ? " support-ticket-item--active" : ""}" data-ticket-id="${esc(ticket.id)}"><span class="status-pill status-pill--${["resolved", "closed"].includes(ticket.status) ? "healthy" : ticket.priority === "urgent" ? "risk" : "neutral"}">${esc(ticket.status.replace("_", " "))}</span><strong>${esc(ticket.subject)}</strong><small>${esc(ticket.category)} · ${formatDate(ticket.last_activity_at)}</small></button>`).join("");
}

function renderThread(payload) {
  const mount = document.getElementById("support-thread");
  if (!mount) return;
  const ticket = payload.selected;
  if (!ticket) return;
  const closed = ticket.status === "closed";
  mount.innerHTML = `<div class="support-thread__head"><div><span class="app-section-kicker">${esc(ticket.category)} · ${esc(ticket.priority)} priority</span><h2>${esc(ticket.subject)}</h2><p>${esc(ticket.id)} · opened ${formatDate(ticket.created_at)}</p></div><span class="status-pill status-pill--${["resolved", "closed"].includes(ticket.status) ? "healthy" : "neutral"}">${esc(ticket.status.replace("_", " "))}</span></div><div class="support-messages">${(payload.messages || []).map((message) => `<article class="support-message support-message--${esc(message.author_kind)}"><div><strong>${message.author_kind === "admin" ? "AdsForecast support" : "You"}</strong><time>${formatDate(message.created_at)}</time></div><p>${esc(message.body).replace(/\n/g, "<br>")}</p></article>`).join("") || '<p class="dashboard-empty">No messages are available.</p>'}</div>${closed ? '<p class="support-closed-note">This ticket is closed. Open a new ticket if you still need help.</p>' : '<form class="support-reply-form" id="support-reply-form"><label class="app-pref-field">Reply<textarea class="app-pref-input" name="message" rows="4" maxlength="5000" minlength="2" required placeholder="Add context or answer the support team"></textarea></label><div><button class="btn btn--primary" type="submit">Send reply</button></div></form>'}`;
  document.getElementById("support-reply-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); const message = new FormData(form).get("message");
    button.disabled = true; setFeedback("Sending reply…");
    const result = demo ? { ok: true } : await updateSupportCenter("reply_ticket", { ticketId: selectedId, message });
    if (!result.ok) { button.disabled = false; setFeedback(result.data?.message || "Reply could not be sent.", "error"); return; }
    setFeedback("Reply sent.", "success"); await loadTickets(selectedId);
  });
}

async function loadTickets(ticketId = "") {
  if (demo) {
    tickets = [{ id: "tkt_demo_01", subject: "Understanding modeled profit", category: "product", priority: "normal", status: "waiting_customer", created_at: new Date(Date.now() - 86_400_000).toISOString(), last_activity_at: new Date().toISOString() }];
    selectedId = ticketId || tickets[0].id; renderList(); renderThread({ selected: tickets[0], messages: [{ author_kind: "customer", body: "How does the contribution model use Meta purchase value?", created_at: tickets[0].created_at }, { author_kind: "admin", body: "Meta supplies attributed purchase value. AdsForecast applies your saved variable-cost assumptions and ad spend to model contribution; it does not claim accounting profit.", created_at: tickets[0].last_activity_at }] }); return;
  }
  const result = await fetchSupportCenter(ticketId);
  if (!result.ok) { setFeedback(result.data?.message || "Support tickets could not be loaded.", "error"); return; }
  tickets = result.data.tickets || []; selectedId = ticketId; renderList(); if (ticketId) renderThread(result.data);
}

async function init() {
  wireCommonShell("support"); const auth = await initAppPage("support.html"); if (!auth.ok) return;
  demo = Boolean(auth.demo); setTopbarIdentity(auth.profile, false, demo ? "Sample support workspace" : "Authenticated support workspace", demo ? "demo" : "account");
  const dialog = document.getElementById("support-dialog");
  document.getElementById("support-new-ticket")?.addEventListener("click", () => dialog?.showModal());
  document.querySelectorAll("[data-support-close]").forEach((button) => button.addEventListener("click", () => dialog?.close()));
  document.getElementById("support-refresh")?.addEventListener("click", () => loadTickets(selectedId));
  document.getElementById("support-ticket-list")?.addEventListener("click", async (event) => { const button = event.target.closest("[data-ticket-id]"); if (!button) return; selectedId = button.dataset.ticketId || ""; renderList(); await loadTickets(selectedId); });
  document.getElementById("support-create-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const button = form.querySelector('button[type="submit"]'); button.disabled = true; setFeedback("Opening ticket…");
    const result = demo ? { ok: true, data: { ticket: { id: "tkt_demo_new" } } } : await updateSupportCenter("create_ticket", values);
    button.disabled = false;
    if (!result.ok) { setFeedback(result.data?.message || "Ticket could not be opened.", "error"); return; }
    form.reset(); dialog?.close(); setFeedback("Ticket opened. The request is now in the support queue.", "success"); await loadTickets(result.data?.ticket?.id || "");
  });
  await loadTickets();
}

init();
