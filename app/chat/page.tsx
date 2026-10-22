"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MISSIONS } from "@/lib/coach";
import { type ChatMessage, MAX_CHARS, normalizeCode, repliesLeft } from "@/lib/meter";

type Status = { balance: number; initial: number; expiresAt: string; expired: boolean };

// All conversation state lives in this browser's localStorage. Wrapped because
// storage can throw (private mode, blocked site data); the chat still works without it.
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k); } catch {} },
};
const PASS_KEY = "sc.pass";
const chatKey = (code: string) => `sc.chat.${code}`;

export default function Chat() {
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Pick up the pass from #pass=... (fresh purchase) or from this device.
  useEffect(() => {
    const fromHash = normalizeCode(new URLSearchParams(location.hash.slice(1)).get("pass"));
    if (fromHash) {
      store.set(PASS_KEY, fromHash);
      history.replaceState(null, "", location.pathname);
    }
    const c = fromHash ?? normalizeCode(store.get(PASS_KEY));
    if (c) {
      // localStorage only exists in the browser, so this mount-time read can't move into render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCode(c);
      setMessages(JSON.parse(store.get(chatKey(c)) ?? "[]"));
    }
    setLoaded(true);
  }, []);

  useEffect(() => { if (code) refresh(code); }, [code]);
  useEffect(() => { if (code && !busy) store.set(chatKey(code), JSON.stringify(messages)); }, [code, messages, busy]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function refresh(c: string) {
    const res = await fetch("/api/pass", { method: "POST", body: JSON.stringify({ code: c }) });
    if (res.ok) { setStatus(await res.json()); setError(null); }
    else setError("We couldn't find that pass code. Check it and try again.");
  }

  function openPass(raw: string) {
    const c = normalizeCode(raw);
    if (!c) return setError("Pass codes look like SPARE-ABCD-EFGH-JKMN.");
    store.set(PASS_KEY, c);
    setCode(c);
    setMessages(JSON.parse(store.get(chatKey(c)) ?? "[]"));
  }

  function forget() {
    if (!code || !confirm("Remove this pass and its chat from this device? Write the code down first if you want to use it again.")) return;
    store.del(PASS_KEY);
    store.del(chatKey(code));
    setCode(null); setStatus(null); setMessages([]);
  }

  // Every reply resends the whole conversation, so a fresh chat for a new task makes the pass last longer.
  function newChat() {
    if (!confirm("Start a new chat? This conversation will be cleared from this device.")) return;
    setMessages([]); setError(null);
  }

  function copy(i: number, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    }, () => {});
  }

  async function send(text: string) {
    if (!code || busy || !text.trim()) return;
    if (text.length > MAX_CHARS) return setError("That message is too long. Try pasting a shorter part.");
    const next: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    // Keep the conversation under the server's size limit by dropping the oldest exchanges.
    while (next.length > 1 && next.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) next.splice(0, 2);
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    let reply = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ code, messages: next }) });
      if (!res.ok || !res.body) {
        setMessages(next.slice(0, -1));
        setInput(text);
        setError(res.status === 402 ? "This pass is used up or has expired." : "Something went wrong. Please try again.");
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += value;
        setMessages([...next, { role: "assistant", content: reply }]);
      }
    } catch {
      // An empty reply would be saved and then rejected by the server on every later send, so drop it.
      if (!reply) {
        setMessages(next.slice(0, -1));
        setInput(text);
      }
      setError("Connection lost. Check your internet and try again.");
    } finally {
      setBusy(false);
      refresh(code);
    }
  }

  if (!loaded) return null;

  if (!code) {
    return (
      <main className="wrap stack">
        <p className="muted small"><Link href="/">SPARE CHANGE</Link></p>
        <h1>Enter your pass code</h1>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); openPass(new FormData(e.currentTarget).get("code") as string); }}>
          <input name="code" placeholder="SPARE-ABCD-EFGH-JKMN" autoComplete="off" aria-label="Pass code" />
          <button className="btn">Open my pass</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="muted small">No pass yet? <Link href="/">Get one for $5.</Link></p>
      </main>
    );
  }

  const empty = status !== null && (status.expired || repliesLeft(status.balance) === 0);
  const pct = status ? Math.round((status.balance / status.initial) * 100) : 0;

  return (
    <main className="chat">
      <header>
        <Link href="/" className="display" style={{ textDecoration: "none" }}>Spare Change</Link>
        <div className="gauge small">
          <div className="meter" aria-hidden><span style={{ width: `${pct}%` }} /></div>
          <span className="muted">
            {status
              ? status.expired
                ? "Pass expired"
                : `${pct}% left · about ${repliesLeft(status.balance)} replies · until ${new Date(status.expiresAt).toLocaleDateString()}`
              : "Checking your pass…"}
          </span>
        </div>
        <button className="btn ghost small" onClick={newChat} disabled={busy || messages.length === 0}>New chat</button>
        <button className="btn ghost small" onClick={forget}>Forget pass</button>
      </header>

      <section className="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack">
            <h2>What would you like to get done?</h2>
            <p className="muted">Pick a mission to start, or type anything below. You&apos;re talking to an AI, not a person.</p>
            <div className="missions">
              {MISSIONS.map((m) => (
                <button key={m.title} className="card mission" disabled={busy || empty} onClick={() => send(m.prompt)}>
                  <strong>{m.title}</strong>
                  <span className="muted small">{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content || "…"}
            {m.role === "assistant" && m.content && !(busy && i === messages.length - 1) && (
              <button className="btn ghost small copy" onClick={() => copy(i, m.content)}>{copied === i ? "Copied" : "Copy"}</button>
            )}
          </div>
        ))}
        {error && <p role="alert" className="muted">{error}</p>}
        {empty && <p className="muted">This pass is finished. <Link href="/">Get another one</Link> to keep going.</p>}
        <div ref={endRef} />
      </section>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder={empty ? "This pass is finished" : "Type a message. Press Enter to send."}
          aria-label="Message"
          disabled={empty}
          rows={2}
        />
        <button className="btn" disabled={busy || empty || !input.trim()}>{busy ? "…" : "Send"}</button>
      </form>
    </main>
  );
}
