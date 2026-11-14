import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { saveSentenceResult } from "../lib/progressService";
import * as S from "../css/SentenceGame.styles";
import { useSpeechSynthesis, type SpeechLang } from "../hooks/useSpeechSynthesis";

interface Word {
  form:      string;
  word_type: string;
  position:  number;
  uid:       string;
}

interface Sentence {
  id:          string;
  full_text:   string;
  translation: { es?: string; ru?: string };
  words:       Word[];
  level:       string;
}

type TransLang = "es" | "ru";

const TRANS_SPEECH_LANG: Record<TransLang, SpeechLang> = { es: "es-ES", ru: "ru-RU" };
const TARGET_SPEECH_LANG: SpeechLang = "en-US";

// After a correct answer: short pause once the sentence has been said,
// and a safety limit in case the browser never reports the end of speech.
const AFTER_CORRECT_PAUSE_MS = 600;
const AFTER_CORRECT_MAX_MS   = 8000;

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function SentenceGame() {
  const { user } = useAuth();

  const [sentences,   setSentences]   = useState<Sentence[]>([]);
  const [index,       setIndex]       = useState(0);
  const [bank,        setBank]        = useState<Word[]>([]);
  const [slots,       setSlots]       = useState<(Word | null)[]>([]);
  const [dragItem,    setDragItem]    = useState<{ word: Word; from: "bank" | number } | null>(null);
  const [result,      setResult]      = useState<"correct" | "wrong" | null>(null);
  const [showHint,    setShowHint]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [score,       setScore]       = useState({ correct: 0, total: 0 });
  const [transLang,   setTransLang]   = useState<TransLang>("es");
  const dragOver = useRef<"bank" | number | null>(null);
  const { speak, cancel } = useSpeechSynthesis();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever a sentence loads, so a late "speech ended" from an old
  // sentence can't trigger another jump.
  const advanceToken = useRef(0);
  // Latest Enter handler, so the key listener below never sees stale state.
  const onEnterRef = useRef<() => void>(() => {});

  function clearAdvance() {
    advanceToken.current += 1;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  }

  // Stop any speech and pending auto-advance when leaving the page.
  useEffect(() => () => { clearAdvance(); cancel(); }, [cancel]);

  useEffect(() => {
    fetch("/api/game/sentences")
      .then(r => r.json())
      .then(({ sentences, error: e }) => {
        if (e) { setError(e); return; }
        if (!sentences?.length) { setError("No sentences found."); return; }
        const shuffled = shuffle(sentences);
        setSentences(shuffled);
        loadSentence(shuffled, 0);
      })
      .catch(() => setError("Cannot reach the server. Is it running?"))
      .finally(() => setLoading(false));
  }, []);

  function loadSentence(list: Sentence[], i: number) {
    const s = list[i];
    if (!s) return;
    clearAdvance();
    const words: Word[] = s.words.map((w, idx) => ({ ...w, uid: `${w.form}-${idx}` }));
    setBank(shuffle(words));
    setSlots(Array(words.length).fill(null));
    setResult(null);
    setShowHint(false);
    setIndex(i);

    // Read the new sentence aloud in the selected base language.
    const lang: TransLang = s.translation?.[transLang] ? transLang : "es";
    const prompt = s.translation?.[lang];
    if (prompt) speak(prompt, TRANS_SPEECH_LANG[lang], 0.9);
  }

  function onDragStartBank(word: Word) { setDragItem({ word, from: "bank" }); }
  function onDragStartSlot(word: Word, slotIdx: number) { setDragItem({ word, from: slotIdx }); }

  // Move a word from the bank or a slot to another slot or back to the bank.
  // A word that lands in a slot is read aloud.
  function moveWord(word: Word, from: "bank" | number, target: "bank" | number) {
    const newSlots = [...slots];
    const newBank  = [...bank];
    const existing = typeof target === "number" ? newSlots[target] : null;

    if (from === "bank") {
      const bi = newBank.findIndex(w => w.uid === word.uid);
      if (bi !== -1) newBank.splice(bi, 1);
    } else {
      newSlots[from] = null;
    }

    if (typeof target === "number") {
      newSlots[target] = word;
      if (existing && existing.uid !== word.uid) newBank.push(existing);
      speak(word.form, TARGET_SPEECH_LANG);
    } else {
      newBank.push(word);
    }

    setSlots(newSlots);
    setBank(newBank);
  }

  function onDrop(target: "bank" | number) {
    if (!dragItem) return;
    moveWord(dragItem.word, dragItem.from, target);
    setDragItem(null);
    dragOver.current = null;
  }

  // Double-click a bank word: put it in the first empty slot.
  function placeInNextEmpty(word: Word) {
    const empty = slots.findIndex(s => s === null);
    if (empty === -1) return;
    moveWord(word, "bank", empty);
  }

  // Double-click a placed word: send it back to the bank.
  function returnToBank(slotIdx: number) {
    const word = slots[slotIdx];
    if (word) moveWord(word, slotIdx, "bank");
  }

  function checkAnswer() {
    if (slots.some(s => s === null)) return;
    const correct = slots.every((part, idx) => part?.position === idx);
    setResult(correct ? "correct" : "wrong");
    setScore(s => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    if (user) saveSentenceResult(sentences[index].id, correct).catch(() => {});
    // Read the whole sentence: the model sentence when right, the learner's
    // own word order when wrong (so the answer isn't given away).
    const spoken = correct && sentences[index]?.full_text
      ? sentences[index].full_text
      : slots.map(w => w?.form ?? "").join(" ");

    if (!correct) {
      speak(spoken, TARGET_SPEECH_LANG, 0.9);
      return;
    }

    // Correct: say the sentence, then move on to the next one by itself.
    clearAdvance();
    const token = advanceToken.current;
    let started = false;
    const goNext = () => {
      if (started || token !== advanceToken.current) return;
      started = true;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => {
        advanceTimer.current = null;
        if (token === advanceToken.current) next();
      }, AFTER_CORRECT_PAUSE_MS);
    };
    const supported = speak(spoken, TARGET_SPEECH_LANG, 0.9, 1, goNext);
    advanceTimer.current = setTimeout(goNext, supported ? AFTER_CORRECT_MAX_MS : 1200);
  }

  function tryAgain() {
    const s = sentences[index];
    if (!s) return;
    const words: Word[] = s.words.map((w, idx) => ({ ...w, uid: `${w.form}-${idx}` }));
    setBank(shuffle(words));
    setSlots(Array(words.length).fill(null));
    setResult(null);
    setShowHint(false);
  }

  function next() {
    const nextIdx = index + 1;
    if (nextIdx < sentences.length) {
      loadSentence(sentences, nextIdx);
    } else {
      const reshuffled = shuffle(sentences);
      setSentences(reshuffled);
      loadSentence(reshuffled, 0);
    }
  }

  const current        = sentences[index];
  const allPlaced      = bank.length === 0;

  // Enter = "Check answer" (when every word is placed and nothing is checked yet).
  useEffect(() => {
    onEnterRef.current = () => {
      if (result === null && allPlaced) checkAnswer();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      // Let Enter on a focused button or field do its own thing.
      const el = e.target;
      if (el instanceof Element && el.closest("button, input, textarea, select, a")) return;
      e.preventDefault();
      onEnterRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const firstWord      = current?.words.find(w => w.position === 0)?.form ?? "";
  const translationLang: TransLang = current?.translation?.[transLang] ? transLang : "es";
  const translationText = current?.translation?.[translationLang] ?? "";

  if (loading) return (
    <div className={S.loadingScreen}>
      <div className={S.loadingRing} />
    </div>
  );

  if (error) return (
    <div className={S.errorScreen}>
      <div className="text-[40px]">😕</div>
      <div className={S.errorText}>{error}</div>
    </div>
  );

  return (
    <div className={S.page}>
      <main className={S.main}>

        {/* Header */}
        <div className={S.header}>
          <div>
            <h1 className={S.title}>Sentence Builder</h1>
            <p className={S.subtitle}>Translate the sentence into English</p>
          </div>
          <div className={S.scoreBox}>
            <div className={S.scoreNumber}>{score.correct}/{score.total}</div>
            <div className={S.scoreLabel}>Score</div>
          </div>
        </div>

        {/* Legend */}
        <div className={S.legendRow}>
          {S.LEGEND.map(l => {
            const st = S.getTokenStyle(l.type);
            return (
              <div
                key={l.type}
                className={S.legendPill}
                style={{ background: st.bg, border: `1.5px solid ${st.border}`, color: st.text }}
              >
                <span className={S.legendDot} style={{ background: st.text }} />
                {l.label}
              </div>
            );
          })}
        </div>

        {/* Game card */}
        <div className={S.card}>

          {/* Progress bar */}
          <div className={S.progressRow}>
            <div className={S.progressTrack}>
              <div
                className={`${S.progressFill} bg-[image:var(--grad-progress)]`}
                style={{ width: `${((index + 1) / sentences.length) * 100}%` }}
              />
            </div>
            <span className={S.progressLabel}>{index + 1} / {sentences.length}</span>
          </div>

          {/* Sentence to translate */}
          {current && (
            <div className={S.promptBox}>
              <div className="flex items-center justify-between mb-1">
                <p className={`${S.promptEyebrow} m-0`}>Translate into English</p>
                <div className="flex gap-[6px]">
                  {(["es", "ru"] as TransLang[]).map(lang => (
                    <button
                      key={lang}
                      onClick={() => setTransLang(lang)}
                      className={`text-[11px] font-bold py-[2px] px-[10px] rounded-[20px] border-[1.5px] cursor-pointer transition-all ${
                        transLang === lang
                          ? "border-[var(--c-purple-muted)] bg-[var(--c-purple-tint)] text-[var(--c-purple)]"
                          : "border-[var(--border-medium)] bg-transparent text-[var(--text-secondary)]"
                      }`}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className={`${S.promptText} flex-1`}>{translationText || "—"}</p>
                {translationText && (
                  <button
                    type="button"
                    onClick={() => speak(translationText, TRANS_SPEECH_LANG[translationLang], 0.9)}
                    className={S.speakBtn}
                    aria-label="Listen to the sentence"
                    title="Listen"
                  >
                    🔊
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Answer slots */}
          <div className={S.slotsArea}>
            <p className={S.sectionLabel}>Build the sentence</p>
            <div
              className="min-h-[80px] rounded-[16px] p-3 flex flex-wrap gap-2 items-center transition-[border-color] duration-150"
              style={{ border: S.dropZoneBorder(dragOver.current === "bank") }}
              onDragOver={e => { e.preventDefault(); dragOver.current = "bank"; }}
              onDrop={() => onDrop("bank")}
            >
              {slots.map((word, idx) => {
                const st = word ? S.getTokenStyle(word.word_type) : null;
                return (
                  <div
                    key={idx}
                    className={S.slot}
                    style={{
                      ...S.slotBorderStyle(st ? st.border : null, dragOver.current === idx),
                      background: st ? st.bg : "var(--bg-surface)",
                      cursor:     word ? "grab" : "default",
                    }}
                    draggable={!!word}
                    onDragStart={() => word && onDragStartSlot(word, idx)}
                    onDoubleClick={() => returnToBank(idx)}
                    title={word ? "Double-click to send back" : undefined}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); dragOver.current = idx; }}
                    onDrop={e => { e.stopPropagation(); onDrop(idx); }}
                  >
                    {word ? (
                      <>
                        <span className="font-bold text-[15px]" style={{ color: st!.text }}>{word.form}</span>
                        {st!.label && <span className="text-[9px] opacity-70 font-semibold" style={{ color: st!.text }}>{st!.label}</span>}
                      </>
                    ) : (
                      <span className={S.slotEmpty}>_</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Word bank */}
          <div className={S.bankArea}>
            <p className={S.sectionLabel}>Word bank</p>
            <div className={S.bankPool}>
              {bank.length === 0 ? (
                <span className={S.bankEmpty}>All words placed ✓</span>
              ) : bank.map(word => {
                const st = S.getTokenStyle(word.word_type);
                return (
                  <div
                    key={word.uid}
                    draggable
                    onDragStart={() => onDragStartBank(word)}
                    onDoubleClick={() => placeInNextEmpty(word)}
                    title="Drag, or double-click to place"
                    className={S.bankChip}
                    style={{ border: `2px solid ${st.border}`, background: st.bg }}
                  >
                    <span className="font-bold text-[15px]" style={{ color: st.text }}>{word.form}</span>
                    {st.label && <span className="text-[9px] opacity-70 font-semibold" style={{ color: st.text }}>{st.label}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Result */}
          {result && (
            <div
              className={`px-5 py-[14px] rounded-[14px] mb-5 font-bold text-[15px] flex items-center gap-[10px] border-[1.5px] ${
                result === "correct"
                  ? "bg-[var(--state-correct-bg)] border-[var(--state-correct-bd)] text-[var(--state-correct)]"
                  : "bg-[var(--state-wrong-bg)] border-[var(--state-wrong-bd)] text-[var(--state-wrong)]"
              }`}
            >
              {result === "correct" ? "✅ Correct!" : "❌ Not quite — try again or skip"}
              {result === "correct" && current?.full_text && (
                <span className="font-normal text-[var(--text-secondary)] text-[13px]">→ {current.full_text}</span>
              )}
            </div>
          )}

          {/* Hint — reveals only the first word */}
          {showHint && (
            <div className={S.hintBox}>
              💡 The sentence starts with: <span className="font-bold">"{firstWord}"</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className={S.actionsRow}>
          {result === "wrong" ? (
            <>
              <button
                onClick={tryAgain}
                className={`${S.btnCheckBase} cursor-pointer bg-[image:var(--grad-btn-danger)] text-white`}
              >
                🔄 Try again
              </button>
              <button onClick={next} className={S.btnSecondary}>
                Skip →
              </button>
            </>
          ) : result === "correct" ? null : (
            <>
              <button
                onClick={checkAnswer}
                disabled={!allPlaced}
                className={`${S.btnCheckBase} ${
                  allPlaced
                    ? "cursor-pointer bg-[image:var(--grad-purple-green)] text-white"
                    : "cursor-not-allowed bg-[image:var(--grad-purple-green)] text-white opacity-40"
                }`}
              >
                Check answer <span className="opacity-70 text-xs font-semibold ml-1">(Enter)</span>
              </button>
              <button
                onClick={() => setShowHint(h => !h)}
                className={S.btnSecondary}
              >
                💡 Hint
              </button>
              <button onClick={next} className={S.btnSecondary}>
                Skip →
              </button>
            </>
          )}
        </div>

        {/* Dot navigation */}
        <div className={S.dotsRow}>
          {sentences.map((_, i) => (
            <div
              key={i}
              onClick={() => loadSentence(sentences, i)}
              className={`${S.dot} ${i === index ? "w-5 bg-[var(--c-purple)]" : "w-2 bg-[var(--border-medium)]"}`}
            />
          ))}
        </div>

      </main>
    </div>
  );
}
