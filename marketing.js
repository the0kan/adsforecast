/** Lightweight interactions for the public marketing page. */

document.documentElement.classList.add("js");

function setupFloatingHeader() {
  const header = document.querySelector(".site-header");
  if (!(header instanceof HTMLElement)) return;

  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function setupSectionReveal() {
  const elements = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!elements.length) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

  elements.forEach((element) => observer.observe(element));
}

function setupPricingCadence() {
  const controls = Array.from(document.querySelectorAll("[data-pricing-cadence]"));
  if (!controls.length) return;

  const setCadence = (cadence) => {
    const safeCadence = cadence === "annual" ? "annual" : "monthly";
    controls.forEach((control) => {
      control.setAttribute("aria-pressed", String(control.getAttribute("data-pricing-cadence") === safeCadence));
    });

    document.querySelectorAll("[data-price]").forEach((price) => {
      const value = safeCadence === "annual" ? price.getAttribute("data-annual") : price.getAttribute("data-monthly");
      price.textContent = `$${value}`;
    });

    document.querySelectorAll("[data-billing-copy]").forEach((copy) => {
      copy.textContent = safeCadence === "annual" ? copy.getAttribute("data-annual-copy") : copy.getAttribute("data-monthly-copy");
    });

    document.querySelectorAll("[data-plan-link]").forEach((link) => {
      const plan = link.getAttribute("data-plan") || "growth";
      link.setAttribute("href", `signup.html?next=billing.html&plan=${encodeURIComponent(plan)}&cadence=${safeCadence}`);
    });
  };

  controls.forEach((control) => {
    control.addEventListener("click", () => setCadence(control.getAttribute("data-pricing-cadence")));
  });
}

/**
 * Progressive hero depth enhancement.
 * The DOM remains the accessible source of truth; this layer only owns the
 * presentation transform and is disabled for touch-sized and reduced-motion UIs.
 */
function setupHeroDepth() {
  const stage = document.querySelector("[data-tilt-stage]");
  const surface = stage?.querySelector("[data-tilt-surface]");
  if (!(stage instanceof HTMLElement) || !(surface instanceof HTMLElement)) return;

  const precisionPointer = window.matchMedia("(pointer: fine) and (min-width: 901px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  const reset = () => {
    window.cancelAnimationFrame(frame);
    surface.style.removeProperty("--tilt-x");
    surface.style.removeProperty("--tilt-y");
  };

  const update = (event) => {
    if (!precisionPointer.matches || reducedMotion.matches) {
      reset();
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      surface.style.setProperty("--tilt-x", `${(-vertical * 3.2).toFixed(2)}deg`);
      surface.style.setProperty("--tilt-y", `${(horizontal * 4.2).toFixed(2)}deg`);
    });
  };

  stage.addEventListener("pointermove", update, { passive: true });
  stage.addEventListener("pointerleave", reset);
  reducedMotion.addEventListener?.("change", reset);
  precisionPointer.addEventListener?.("change", reset);
}

async function setupSessionAwareActions() {
  try {
    const { getSupabaseClient } = await import("./supabase.js");
    const client = await getSupabaseClient();
    if (!client) return;
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) return;
    document.documentElement.setAttribute("data-authenticated", "true");
    document.querySelectorAll("[data-session-action=primary]").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      link.href = "overview.html";
      link.textContent = "Open dashboard";
    });
    document.querySelectorAll("[data-session-action=secondary]").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      link.href = "billing.html";
      link.textContent = "Plans & billing";
    });
  } catch {
    // The marketing page remains usable when the optional session check is unavailable.
  }
}

setupFloatingHeader();
setupSectionReveal();
setupPricingCadence();
setupHeroDepth();
void setupSessionAwareActions();
