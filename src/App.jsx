import { useState, useRef, useEffect } from "react";

/*  FlexLife role-play — live chat.
    The SME chats as the producer. Claude answers in real time as the prospect
    from a persona brief with a hidden internal state. Any message can be
    annotated; any prospect message can be edited or regenerated. Export gives
    the same columns as the conversation tracker.                             */

const MODEL = "claude-sonnet-4-6";

const FRED = {
  conversation_id: "CONV-001",
  persona_id: "P01",
  persona_name: "Fred",
  known_background: `Age: 34
Relationship: Engaged; plans to marry within a year
Occupation: Marketing manager
Income: $92,000
Housing: Rents; plans to purchase a home within two years
Dependents: None currently; expects to have children
Current coverage: Basic employer-provided life insurance
Savings: Contributes to a 401(k); limited non-retirement savings
Debt: Has student loans
Financial goals: Purchase a home, start a family, and build accessible savings
Primary concerns: Maintaining flexibility and avoiding excessive fixed expenses
Product interest: Interested in protection that can adapt as life changes and potentially provide value beyond a death benefit`,
  hidden_customer_state: `Believes life insurance may be premature before having children
May interpret a large recommendation as evidence that the rep did not listen
Responds poorly to fear-based language
Likely objection: "This makes sense, but I'm not sure I need to start yet."
Decision requirement: The rep must show why acting now supports flexibility rather than limiting it
Positive signal: Engages when the recommendation connects to homeownership and future family plans
Trust breaker: Treating hypothetical future risks as immediate emergencies`,
  training_objective:
    "Show why starting now preserves flexibility as life changes, without fear-based pressure",
};

const SEED = {
  conversation_id: "CONV-002",
  persona_id: "P02",
  persona_name: "Oliver",
  known_background: `Age: 44
Relationship: Married
Occupation: Operations director
Household income: $165,000
Housing: Owns a home with a mortgage
Dependents: Two children, ages 8 and 12
Current coverage: Employer-provided insurance and an older term policy
Savings: Contributes to retirement and college-savings accounts
Financial obligations: Mortgage, children's activities, household expenses, and education goals
Budget: Income is strong, but monthly cash flow is tight
Financial goals: Protect household income, fund education, and maintain family stability
Primary concerns: Death, serious illness, and an interruption in earned income
Decision dynamics: Spouse is cautious and participates in major financial decisions
Product interest: Wants sufficient protection without disrupting current family priorities`,
  hidden_customer_state: `Worries that the recommendation will require sacrificing college savings or family activities
Is sensitive to being told the family is underinsured
May use existing employer coverage as a reason to delay
Needs reassurance that the recommendation is appropriately sized
Likely objection: "We already have coverage, and I'm not sure we can add another expense."
Decision requirement: The rep must clearly prioritize needs and explain affordable tradeoffs
Positive signal: Becomes engaged when the rep connects benefits to keeping the family's plans intact
Trust breaker: Recommending the maximum coverage without acknowledging cash-flow constraints`,
  training_objective:
    "Demonstrate how FlexLife addresses identified protection gaps within a sustainable budget",
};

const ZAC = {
  conversation_id: "CONV-003",
  persona_id: "P03",
  persona_name: "Zac",
  known_background: `Age: 54
Relationship: Married
Occupation: Marketing Sr. Manager
Household income: $165,000
Housing: Owns a home with a mortgage
Dependents: One child, age 20, living away at college
Current coverage: Employer-provided basic life insurance
Savings: Contributes to a 401(k); has a $50,000 CD account
Financial obligations: Mortgage, household expenses, and paying for his child's university costs
Budget: Income is strong, but monthly cash flow is tight
Financial goals: Protect household income and plan for retirement
Primary concerns: Death, serious illness, and an interruption in earned income
Decision dynamics: Spouse is anxious about tuition draining their monthly spending budget`,
  hidden_customer_state: `Worries that insurance cost would limit his contribution to his child's university costs
May use existing employer coverage as a reason to delay
Responds poorly to fear-based language
Likely objection: "We already have coverage, and I'm not sure we can add another expense."
Decision requirement: The rep must clearly prioritize needs and explain affordable tradeoffs
Father had Alzheimer's and spent his final years in a memory care facility; Zac privately worries about repeating that path and burdening his child with the cost
Currently has only basic employer coverage — no ABR, no PCC. The free Chronic Illness ABR has never been explained to him, let alone why PCC costs more
Sensitive to the extra premium for PCC specifically. He will ask "why pay more when the regular chronic rider is free?"
Trust breaker: Recommending PCC without acknowledging the added cost against his tuition-strained cash flow, or without explaining how it differs from the free rider he could get instead`,
  training_objective:
    "Justify the PCC rider's added cost and dollar-for-dollar payout versus the free Chronic Illness ABR, against tuition-strained cash flow",
};

const PERSONAS = [FRED, SEED, ZAC];

const STATES = [
  "interested_but_uncertain", "timing_concern", "affordability_concern",
  "information_seeking", "partially_reassured", "more_confident",
  "nearly_resolved", "resolved", "no_more_questions",
];

// The model sometimes echoes the literal "snake_case" placeholder from the
// prompt instead of a real state. Drop it so it never shows in the UI or CSV.
const cleanState = (s) => {
  const v = (s || "").trim();
  return v.toLowerCase() === "snake_case" ? "" : v;
};

// The model writes typographic punctuation (em/en dashes, curly quotes,
// ellipses). Those turn into garbage like "â€"" when Excel opens a CSV, so we
// fold them down to plain ASCII for the exports.
const toPlain = (s) =>
  String(s ?? "")
    .replace(/[—–]/g, "-")   // em / en dash
    .replace(/[‘’‛]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"')   // curly double quotes
    .replace(/…/g, "...")          // ellipsis
    .replace(/ /g, " ");           // non-breaking space

async function callClaude(prompt) {
  // Goes to the local Express proxy (server.js), which forwards to Azure OpenAI
  // and returns { text: "...JSON..." }. The prompts all ask for a JSON object.
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch {}
    throw new Error(detail || `request failed (${res.status})`);
  }
  const data = await res.json();
  const text = data.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export default function RolePlayChat() {
  const [p, setP] = useState(() => {
    try {
      const saved = localStorage.getItem("flexlife_persona");
      if (saved) return { ...SEED, ...JSON.parse(saved) };
    } catch {}
    return SEED;
  });
  const [product, setProduct] = useState(() => {
    try { return localStorage.getItem("flexlife_product") || ""; } catch { return ""; }
  });
  const [personaSaved, setPersonaSaved] = useState(false);
  const [plan, setPlan] = useState({ gaps: "", rec: "", tradeoffs: "" });
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [think, setThink] = useState({ read: "", why: "", held: "" });
  const [noteOpen, setNoteOpen] = useState(false);
  const [ownOpener, setOwnOpener] = useState("");
  const [agentOpener, setAgentOpener] = useState("");
  const [undo, setUndo] = useState(null);
  const [typing, setTyping] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [openNote, setOpenNote] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const scroller = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, typing]);

  const savePersona = () => {
    try {
      localStorage.setItem("flexlife_persona", JSON.stringify(p));
      localStorage.setItem("flexlife_product", product);
      setPersonaSaved(true);
      setTimeout(() => setPersonaSaved(false), 1500);
    } catch {}
  };

  const brief = `PERSONA: ${p.persona_name} (${p.persona_id})

SCENE — you are already mid-conversation. The fact-find is finished, which is why the producer knows everything under KNOWN BACKGROUND, and they have just turned the conversation toward FlexLife and how it would apply to your situation. Behave accordingly:
- No greetings, no small talk, no "good to see you," no asking what they have prepared. You are several minutes in and the recommendation is already on the table between you.
- Do not re-introduce yourself or re-explain your situation. You already walked them through all of it and you expect them to use it.
- If they ask discovery questions you already answered, or describe FlexLife in generic terms that could apply to anyone, say so — politely the first time, less patiently after that.
- What you are trying to get out of this stretch of the conversation is whether this actually fits your family: what it covers that you do not already have, why that amount, and what it does to your monthly cash flow.

KNOWN BACKGROUND — you already told the producer all of this:
${p.known_background}

HIDDEN DETAILS — these drive your reactions. Never recite or summarise them:
${p.hidden_customer_state}

HOW TO USE THE HIDDEN DETAILS:
- Raise the likely objection early if the producer has not already handled it, in your own words rather than verbatim.
- Warm up and lean in when the producer hits the positive signal.
- Cool off, get guarded and slow the conversation down if the producer does the trust-breaking thing. Do not reward it.
- Do not agree to anything until the decision requirement has actually been met.

WHAT THE PRODUCER IS TRYING TO DO in this meeting: ${p.training_objective}
PRODUCT IN SCOPE: FlexLife.
PRODUCT FACTS YOU MAY RELY ON: ${product.trim() || "(none supplied — do not invent mechanics, rates or guarantees; ask the producer instead)"}`;

  const script = (list) =>
    list.length
      ? list
          .filter((m) => m.speaker !== "thinking")
          .map((m) => `${m.speaker === "rep" ? "PRODUCER" : "PROSPECT"}: ${m.text}`)
          .join("\n")
      : "(the fact-find has just wrapped and the producer has begun showing how FlexLife would apply to you — you speak next)";

  async function reply(history, opening = false) {
    return callClaude(
      `You are role-playing a prospect in a life insurance sales meeting, for a training dataset. Stay in character.

${brief}

CONVERSATION SO FAR:
${script(history)}

${
  opening
    ? "You speak next, and you are picking up mid-conversation. React to the producer starting to show you how FlexLife applies to your family: a question about how it works against what you already have, a caveat, or a worry about where this is heading. Start in the middle — no greeting, no pleasantries, no asking what they put together, and nothing that reads like the first line of a meeting. Do not summarise your own situation back to them, do not pitch yourself into the sale, and do not do the producer's job for them."
    : "Answer as the prospect."
} Keep it to 1–3 sentences of ordinary spoken language. Never state your hidden details outright — let them shape what you push back on. Only treat a concern as settled if the producer actually addressed it. Raise one thing at a time.

Return ONLY JSON: {"text":"...","state":"one of: ${STATES.join(" / ")}","open":"short phrase or None","end":"in_progress | near_complete | no_more_questions"}`
    );
  }

  async function openAsProspect() {
    setError("");
    setTyping(true);
    try {
      const out = await reply([], true);
      setMsgs([
        {
          id: crypto.randomUUID(),
          speaker: "customer",
          text: out.text,
          original: out.text,
          state: cleanState(out.state),
          open: out.open || "",
          end: out.end || "in_progress",
          note: "",
          origin: "ai",
        },
      ]);
    } catch (e) {
      setError(`${p.persona_name} didn't open: ${e.message}`);
    }
    setTyping(false);
  }

  async function send(text) {
    const body = text.trim();
    if (!body || typing) return;
    setUndo(null);
    const history = [
      ...msgs,
      {
        id: crypto.randomUUID(),
        speaker: "rep",
        text: body,
        note: "",
        reasoning: { read: think.read.trim(), why: think.why.trim(), held: think.held.trim() },
        label: "",
      },
    ];
    setMsgs(history);
    setInput("");
    setThink({ read: "", why: "", held: "" });
    setNoteOpen(false);
    setError("");
    setTyping(true);
    try {
      const out = await reply(history);
      setMsgs([
        ...history,
        {
          id: crypto.randomUUID(),
          speaker: "customer",
          text: out.text,
          original: out.text,
          state: cleanState(out.state),
          open: out.open || "",
          end: out.end || "in_progress",
          note: "",
          origin: "ai",
        },
      ]);
    } catch (e) {
      setError(`${p.persona_name} didn't answer: ${e.message}`);
    }
    setTyping(false);
  }

  async function retry(id) {
    const i = msgs.findIndex((m) => m.id === id);
    setTyping(true);
    setError("");
    try {
      const out = await reply(msgs.slice(0, i), i === 0);
      setMsgs((prev) =>
        prev.map((m, j) =>
          j === i
            ? { ...m, text: out.text, original: out.text, state: cleanState(out.state), open: out.open || "", end: out.end || "in_progress" }
            : m
        )
      );
    } catch (e) {
      setError(`Couldn't get another answer: ${e.message}`);
    }
    setTyping(false);
  }

  async function draftForMe() {
    setDrafting(true);
    setError("");
    try {
      const out = await callClaude(
        `You are helping an experienced life insurance producer with their next line in a follow-up presentation meeting. Fact-finding is already done; the producer is presenting a FlexLife recommendation built from the prospect's own information. This becomes gold-standard reference data, so it must be compliant and realistic.

${brief}

THE PRODUCER'S OWN PLAN for this recommendation — stay inside it, do not invent a different recommendation:
- Protection gaps identified: ${plan.gaps.trim() || "(not written down yet)"}
- What they are recommending: ${plan.rec.trim() || "(not written down yet)"}
- Priorities and tradeoffs they intend to protect: ${plan.tradeoffs.trim() || "(not written down yet)"}

CONVERSATION SO FAR:
${script(msgs)}

Draft the producer's next message: plain language, 2–5 sentences, tied to this prospect's specific background rather than generic benefit language. No fear-based urgency, no unsupported guarantees, no claim about a product mechanic that is not in the product facts above. Acknowledge cash flow before naming any amount. Close by checking understanding or asking permission to continue.

Return ONLY JSON: {"text":"..."}`
      );
      setInput(out.text || "");
      box.current?.focus();
    } catch (e) {
      setError(`Draft didn't come back: ${e.message}`);
    }
    setDrafting(false);
  }

  function openWithOwnLine() {
    const body = ownOpener.trim();
    if (!body) return;
    setMsgs([
      {
        id: crypto.randomUUID(),
        speaker: "customer",
        text: body,
        original: "",
        state: "",
        open: "",
        end: "in_progress",
        note: "",
        origin: "sme",
      },
    ]);
    setOwnOpener("");
  }

  // Agent-first opener: the producer speaks the first line and the prospect
  // AI answers it. send() already handles a rep turn from an empty thread.
  function startAsAgent() {
    const body = agentOpener.trim();
    if (!body) return;
    setAgentOpener("");
    send(body);
  }

  function postThinking() {
    const entry = [
      think.read.trim() && `Reading: ${think.read.trim()}`,
      think.why.trim() && `Intent: ${think.why.trim()}`,
      think.held.trim() && `Held back: ${think.held.trim()}`,
    ].filter(Boolean).join("\n");
    if (!entry) return;
    setMsgs((prev) => [...prev, { id: crypto.randomUUID(), speaker: "thinking", text: entry }]);
    setThink({ read: "", why: "", held: "" });
    setNoteOpen(false);
  }

  // A rewritten line becomes the line that was actually said, so anything the
  // prospect and producer said after it was answering a message that no longer
  // exists. Swap the text in and cut the thread back to that point.
  function commitRewrite(id, fields) {
    const i = msgs.findIndex((m) => m.id === id);
    if (i < 0) return;
    const dropped = msgs.length - (i + 1);
    setUndo(dropped > 0 ? { msgs, count: dropped } : null);
    setMsgs(msgs.slice(0, i + 1).map((m, j) => (j === i ? { ...m, ...fields } : m)));
  }

  const removeMsg = (id) => setMsgs((prev) => prev.filter((m) => m.id !== id));

  const patch = (id, f) => setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, ...f } : m)));

  function csv() {
    const cols = ["conversation_id","persona_id","persona_name","known_background","hidden_customer_state","training_objective","plan_protection_gaps","plan_recommendation","plan_budget_tradeoffs","turn_number","speaker","utterance","rep_behavior_label","customer_state_after_turn","unresolved_questions","end_state","sme_note","utterance_origin"];
    const esc = (v) => `"${toPlain(v).replace(/"/g, '""')}"`;
    let turn = 0;
    const rows = msgs.map((m, i) =>
      [p.conversation_id, p.persona_id, p.persona_name,
        i === 0 ? p.known_background : "", i === 0 ? p.hidden_customer_state : "",
        p.training_objective,
        i === 0 ? plan.gaps : "", i === 0 ? plan.rec : "", i === 0 ? plan.tradeoffs : "",
        m.speaker === "thinking" ? "" : ++turn, m.speaker, m.text, m.label || "", m.state || "",
        m.open || "",
        m.speaker === "thinking" ? "" : m.end || "in_progress",
        m.speaker === "thinking" ? m.text : m.note || "",
        m.speaker === "customer" ? (m.origin === "sme" ? "sme_written" : "ai_generated") : "",
      ].map(esc).join(",")
    );
    return [cols.join(","), ...rows].join("\n");
  }

  function copyRows() {
    navigator.clipboard.writeText(csv());
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    // Lead with a UTF-8 BOM so Excel decodes the file as UTF-8 instead of
    // Windows-1252 (which is what turns an em dash into "â€"").
    const BOM = String.fromCharCode(0xfeff);
    const b = new Blob([BOM + csv()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${p.conversation_id}_${p.persona_id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Same content as the CSV, but as a structured object — persona + plan up top,
  // one entry per turn underneath.
  function conversationData() {
    let turn = 0;
    return {
      conversation_id: p.conversation_id,
      persona_id: p.persona_id,
      persona_name: p.persona_name,
      known_background: p.known_background,
      hidden_customer_state: p.hidden_customer_state,
      training_objective: p.training_objective,
      plan: {
        protection_gaps: plan.gaps,
        recommendation: plan.rec,
        budget_tradeoffs: plan.tradeoffs,
      },
      turns: msgs.map((m) => {
        const thinking = m.speaker === "thinking";
        return {
          turn_number: thinking ? null : ++turn,
          speaker: m.speaker,
          utterance: toPlain(m.text),
          rep_behavior_label: m.label || "",
          customer_state_after_turn: m.state || "",
          unresolved_questions: toPlain(m.open || ""),
          end_state: thinking ? "" : m.end || "in_progress",
          sme_note: toPlain(thinking ? m.text : m.note || ""),
          utterance_origin:
            m.speaker === "customer" ? (m.origin === "sme" ? "sme_written" : "ai_generated") : "",
        };
      }),
    };
  }

  function downloadJson() {
    const b = new Blob([JSON.stringify(conversationData(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${p.conversation_id}_${p.persona_id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Conversation Completed: export both files, then return to the start page.
  function completeConversation() {
    download();
    downloadJson();
    goHome();
  }

  function goHome() {
    setMsgs([]);
    setUndo(null);
    setError("");
  }

  const initials = p.persona_name.split(" ").filter((w) => /[A-Za-z]/.test(w[0])).slice(-2).map((w) => w[0]).join("");

  const facts = p.known_background
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf(":");
      return at > 0 ? [l.slice(0, at), l.slice(at + 1).trim()] : [null, l];
    });

  const factsList = (multi) => (
    <dl className={`grid gap-x-6 gap-y-2 ${multi ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
      {facts.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          {k && <dt className="text-[10px] leading-tight text-slate-400">{k}</dt>}
          <dd className="text-[12px] leading-snug text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );

  const fileBlock = (
    <div className="text-left">
      <p className="mb-1 text-[10px] text-slate-400">Objective</p>
      <p className="mb-4 text-[12px] leading-snug text-teal-800">{p.training_objective}</p>
      <p className="mb-2 text-[10px] text-slate-400">From your fact-find</p>
      {factsList(false)}
    </div>
  );

  const planField = (key, label, hint, rows) => (
    <label className="mb-3 block text-left">
      <span className="mb-1 block text-[12px] font-medium text-slate-700">{label}</span>
      <textarea
        rows={rows}
        value={plan[key]}
        onChange={(e) => setPlan({ ...plan, [key]: e.target.value })}
        placeholder={hint}
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-teal-600"
      />
    </label>
  );

  const planBlock = (
    <div className="text-left">
      {planField("gaps", "Protection gaps you identified", "Which of her stated concerns is actually uncovered today, and by how much — income replacement to the kids' independence, the mortgage balance, the older term policy running out, illness during earning years", 3)}
      {planField("rec", "What you're recommending, and why that size", "The FlexLife structure and amount, tied to the gaps above rather than to the maximum she could qualify for", 3)}
      {planField("tradeoffs", "What you'll protect in her budget", "College savings, the kids' activities, the monthly number you won't cross — and what you'd trim first if it doesn't fit", 3)}
    </div>
  );

  const setupField = (key, rows) => (
    <label className="mb-4 block">
      <span className="mb-1 block text-[12px] text-slate-500">{key.replace(/_/g, " ")}</span>
      {rows ? (
        <textarea rows={rows} value={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.value })}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-teal-600" />
      ) : (
        <input value={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.value })}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] outline-none focus:border-teal-600" />
      )}
    </label>
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-[14px] text-slate-900">
      {/* top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-[13px] font-medium text-white">
          {initials || "P"}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium leading-tight">{p.persona_name}</p>
          <p className="truncate text-[12px] text-slate-500">
            {typing ? "typing…" : msgs.length ? "in conversation" : "FlexLife"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={goHome} className="rounded px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100">Home</button>
          <button onClick={() => setSetupOpen(true)} className="rounded px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100">Persona</button>
          <button onClick={completeConversation} disabled={!msgs.length} className="rounded bg-teal-700 px-3 py-1.5 text-[13px] text-white hover:bg-teal-800 disabled:opacity-40">Conversation Completed</button>
        </div>
      </header>

      {/* mobile file strip */}
      {/* thin facts bar with overlay panel, below the rail breakpoint */}
      <div className="relative shrink-0 xl:hidden">
        <button
          onClick={() => setFileOpen(!fileOpen)}
          className="flex w-full items-baseline gap-3 border-b border-slate-200 bg-white px-4 py-1.5 text-left"
        >
          <span className="truncate text-[12px] text-teal-800">{p.training_objective}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-500">
            {fileOpen ? "hide facts" : "facts"}
          </span>
        </button>
        {fileOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setFileOpen(false)} />
            <div className="absolute inset-x-0 top-full z-20 max-h-72 overflow-y-auto border-b border-slate-200 bg-white px-4 py-3 shadow-lg">
              {factsList(true)}
            </div>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
      {/* thread */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl">
          {!msgs.length && !typing && (
            <div className="mx-auto max-w-lg space-y-4 py-6">
              <p className="text-[12px] text-slate-500">
                Choose how the conversation opens.
              </p>

              {/* Option 1 — the customer speaks first */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-[13px] font-medium text-slate-800">Customer speaks first</p>
                <p className="mb-3 mt-0.5 text-[11px] text-slate-400">
                  {p.persona_name} opens. You land mid-conversation, not at hello.
                </p>
                <button
                  onClick={openAsProspect}
                  className="rounded-full bg-teal-700 px-4 py-2 text-[13px] text-white hover:bg-teal-800"
                >
                  Have {p.persona_name} start
                </button>
                <div className="my-3 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  or write their opening line
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <textarea
                  rows={3}
                  value={ownOpener}
                  onChange={(e) => setOwnOpener(e.target.value)}
                  placeholder={`Write the line you've actually heard from someone like ${p.persona_name} at this point in a real presentation`}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-teal-600"
                />
                <button
                  onClick={openWithOwnLine}
                  disabled={!ownOpener.trim()}
                  className="mt-2 rounded-full border border-slate-300 px-3.5 py-1.5 text-[12px] text-slate-600 hover:border-teal-600 hover:text-teal-700 disabled:opacity-40"
                >
                  Start with this line
                </button>
              </div>

              {/* Option 2 — the agent speaks first */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-[13px] font-medium text-slate-800">You speak first, as the producer</p>
                <p className="mb-3 mt-0.5 text-[11px] text-slate-400">
                  You open the turn and {p.persona_name} responds.
                </p>
                <textarea
                  rows={3}
                  value={agentOpener}
                  onChange={(e) => setAgentOpener(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startAsAgent(); }
                  }}
                  placeholder="Open as the producer — how you'd turn the conversation toward FlexLife"
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-teal-600"
                />
                <button
                  onClick={startAsAgent}
                  disabled={!agentOpener.trim() || typing}
                  className="mt-2 rounded-full bg-teal-700 px-4 py-2 text-[13px] text-white hover:bg-teal-800 disabled:opacity-40"
                >
                  Start with this line
                </button>
              </div>
            </div>
          )}

          {msgs.map((m) => {
            const rep = m.speaker === "rep";

            if (m.speaker === "thinking") {
              return (
                <div key={m.id} className="mb-4 flex justify-center">
                  <div className="w-full max-w-md rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[10px] text-amber-700">your thinking</span>
                      <button onClick={() => removeMsg(m.id)} className="ml-auto text-[10px] text-slate-400 hover:text-amber-700">remove</button>
                    </div>
                    <p className="whitespace-pre-line text-[12px] leading-snug text-amber-900">{m.text}</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className={`mb-4 flex ${rep ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${rep ? "items-end" : "items-start"} flex flex-col`}>
                  <div className={`rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                    rep ? "rounded-br-md bg-teal-700 text-white" : "rounded-bl-md border border-slate-200 bg-white"
                  }`}>
                    {!rep && m.editing ? (
                      <textarea
                        autoFocus
                        rows={5}
                        defaultValue={m.text}
                        onBlur={(e) =>
                          e.target.value.trim() && e.target.value !== m.text
                            ? patch(m.id, { text: e.target.value, origin: "sme", editing: false })
                            : patch(m.id, { editing: false })
                        }
                        className="w-[30rem] max-w-[80vw] resize-y rounded border border-teal-300 bg-white px-2.5 py-2 text-[14px] leading-relaxed text-slate-900 outline-none focus:border-teal-500"
                      />
                    ) : (
                      m.text
                    )}
                  </div>

                  <div className={`mt-1 flex flex-wrap items-center gap-2.5 px-1 text-[11px] text-slate-400 ${rep ? "justify-end" : ""}`}>
                    <button onClick={() => setOpenNote(openNote === m.id ? null : m.id)} className="hover:text-teal-700">
                      {m.note ? "note" : "+ note"}
                    </button>
                    {!rep && (
                      <>
                        <button onClick={() => patch(m.id, { editing: !m.editing })} disabled={typing} className="hover:text-teal-700 disabled:opacity-40">{m.editing ? "done" : "edit"}</button>
                        <button onClick={() => retry(m.id)} disabled={typing} className="hover:text-teal-700 disabled:opacity-40">retry</button>
                      </>
                    )}
                  </div>

                  {m.reasoning && (m.reasoning.read || m.reasoning.why || m.reasoning.held) && (
                    <div className="mt-1 max-w-md rounded-lg bg-amber-50 px-2.5 py-1.5 text-left text-[11px] leading-snug text-amber-900">
                      {m.reasoning.read && <p><span className="text-amber-700">reading: </span>{m.reasoning.read}</p>}
                      {m.reasoning.why && <p><span className="text-amber-700">intent: </span>{m.reasoning.why}</p>}
                      {m.reasoning.held && <p><span className="text-amber-700">held back: </span>{m.reasoning.held}</p>}
                    </div>
                  )}

                  {m.note && openNote !== m.id && (
                    <p className={`mt-1 max-w-md rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] leading-snug text-amber-900 ${rep ? "text-right" : ""}`}>
                      {m.note}
                    </p>
                  )}

                  {openNote === m.id && (
                    <div className="mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white p-2.5">
                      <textarea autoFocus rows={3} defaultValue={m.note}
                        onBlur={(e) => { patch(m.id, { note: e.target.value }); setOpenNote(null); }}
                        placeholder="What you were reading in them, why this line works, what you'd never say here"
                        className="w-full text-[12px] leading-snug outline-none" />
                      {rep && (
                        <input defaultValue={m.label} onBlur={(e) => patch(m.id, { label: e.target.value })}
                          placeholder="behavior label"
                          className="mt-1 w-full border-t border-slate-100 pt-1.5 text-[12px] outline-none" />
                      )}
                    </div>
                  )}

                </div>
              </div>
            );
          })}

          {typing && (
            <div className="mb-4 flex justify-start">
              <div className="flex gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                    style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="mx-auto mb-3 max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-[12px] text-amber-800">
              {error}
            </p>
          )}
        </div>
      </div>

      {undo && (
        <div className="mx-auto mb-2 flex w-full max-w-2xl items-center gap-3 px-4 text-[11px] text-slate-500">
          <span>
            Carrying on from your version — {undo.count} later{" "}
            {undo.count === 1 ? "turn" : "turns"} removed.
          </span>
          <button
            onClick={() => { setMsgs(undo.msgs); setUndo(null); }}
            className="text-teal-700 underline"
          >
            undo
          </button>
          <button onClick={() => setUndo(null)} className="ml-auto text-slate-400 hover:text-slate-600">
            dismiss
          </button>
        </div>
      )}

      {/* composer */}
      {(msgs.length > 0 || typing) && (
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea ref={box} rows={1} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            placeholder="Message as the producer"
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-2xl border border-slate-300 px-3.5 py-2 leading-relaxed outline-none focus:border-teal-600" />
          <button onClick={() => send(input)} disabled={!input.trim() || typing}
            className="shrink-0 rounded-full bg-teal-700 px-4 py-2 text-[13px] text-white hover:bg-teal-800 disabled:opacity-40">
            Send
          </button>
        </div>
      </div>
      )}
        </div>

        {/* live reference rail */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-4 py-4 xl:block">
          {fileBlock}
          <button
            onClick={() => setSetupOpen(true)}
            className="mt-4 w-full rounded border border-slate-300 px-2 py-1.5 text-[12px] text-slate-600 hover:border-teal-600 hover:text-teal-700"
          >
            Persona
          </button>
        </aside>
      </div>

      {/* persona drawer */}
      {setupOpen && (
        <div className="fixed inset-0 z-10 flex justify-end bg-slate-900/20" onClick={() => setSetupOpen(false)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">Persona</h2>
              <button onClick={() => setSetupOpen(false)} className="text-[13px] text-slate-500 hover:text-slate-800">close</button>
            </div>
            <div className="mb-4 flex gap-1.5">
              {PERSONAS.map((preset) => (
                <button
                  key={preset.persona_id}
                  onClick={() => setP(preset)}
                  className={`rounded px-2.5 py-1 text-[12px] ${
                    p.persona_id === preset.persona_id
                      ? "bg-teal-700 text-white"
                      : "border border-slate-300 text-slate-600 hover:border-teal-600 hover:text-teal-700"
                  }`}
                >
                  {preset.persona_name}
                </button>
              ))}
            </div>
            {setupField("conversation_id")}
            {setupField("persona_id")}
            {setupField("persona_name")}
            {setupField("known_background", 14)}
            {setupField("hidden_customer_state", 10)}
            {setupField("training_objective", 3)}
            <label className="mb-2 block">
              <span className="mb-1 block text-[12px] text-slate-500">FlexLife facts the prospect can rely on</span>
              <textarea rows={6} value={product} onChange={(e) => setProduct(e.target.value)}
                placeholder="Paste approved product language. Left empty, the prospect asks instead of assuming."
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-teal-600" />
            </label>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={savePersona}
                className="rounded bg-teal-700 px-4 py-1.5 text-[13px] text-white hover:bg-teal-800">
                Save
              </button>
              {personaSaved && <span className="text-[12px] text-teal-700">Saved</span>}
            </div>
            {msgs.length > 0 && (
              <button onClick={() => { setMsgs([]); setSetupOpen(false); }}
                className="mt-4 block text-[12px] text-slate-500 underline hover:text-amber-700">
                Clear conversation and start over
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
