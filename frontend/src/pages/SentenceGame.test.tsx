import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SentenceGame from "./SentenceGame";

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../lib/progressService", () => ({ saveSentenceResult: vi.fn(() => Promise.resolve()) }));

const SENTENCE = {
  id: "s1",
  full_text: "I like cats.",
  translation: { es: "Me gustan los gatos.", ru: "Я люблю кошек." },
  level: "A1",
  words: [
    { form: "I",    word_type: "pronoun", position: 0 },
    { form: "like", word_type: "verb",    position: 1 },
    { form: "cats", word_type: "noun",    position: 2 },
  ],
};

const SENTENCE_2 = {
  id: "s2",
  full_text: "I like dogs.",
  translation: { es: "Me gustan los perros.", ru: "Я люблю собак." },
  level: "A1",
  words: [
    { form: "I",    word_type: "pronoun", position: 0 },
    { form: "like", word_type: "verb",    position: 1 },
    { form: "dogs", word_type: "noun",    position: 2 },
  ],
};

type FakeUtterance = { text: string; lang: string; onend?: () => void; onerror?: () => void };
let spoken: { text: string; lang: string }[] = [];
let lastUtterance: FakeUtterance | null = null;
let sentencesFromApi: unknown[] = [SENTENCE];

beforeEach(() => {
  spoken = [];
  lastUtterance = null;
  sentencesFromApi = [SENTENCE];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sentences: sentencesFromApi }) })));
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    lang = ""; rate = 1; pitch = 1;
    text: string;
    constructor(text: string) { this.text = text; }
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      cancel: vi.fn(),
      speak: (u: FakeUtterance) => { lastUtterance = u; spoken.push({ text: u.text, lang: u.lang }); },
    },
  });
});

const bankWord = (w: string) => screen.getAllByTitle("Drag, or double-click to place").find(el => el.textContent?.startsWith(w))!;

describe("SentenceGame speech and double-click", () => {
  it("reads a new sentence aloud as soon as it appears", async () => {
    render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");
    expect(spoken[0]).toEqual({ text: "Me gustan los gatos.", lang: "es-ES" });
  });

  it("reads the prompt in the chosen language", async () => {
    render(<SentenceGame />);
    fireEvent.click(await screen.findByRole("button", { name: "Listen to the sentence" }));
    expect(spoken.at(-1)).toEqual({ text: "Me gustan los gatos.", lang: "es-ES" });

    fireEvent.click(screen.getByRole("button", { name: "RU" }));
    fireEvent.click(screen.getByRole("button", { name: "Listen to the sentence" }));
    expect(spoken.at(-1)).toEqual({ text: "Я люблю кошек.", lang: "ru-RU" });
  });

  it("double-click fills the next empty slot, says the word, and Check says the sentence", async () => {
    render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");

    for (const w of ["I", "like", "cats"]) {
      fireEvent.doubleClick(bankWord(w));
      expect(spoken.at(-1)).toEqual({ text: w, lang: "en-US" });
    }
    expect(screen.getByText("All words placed ✓")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
    expect(screen.getByText("✅ Correct!", { exact: false })).toBeInTheDocument();
    expect(spoken.at(-1)).toEqual({ text: "I like cats.", lang: "en-US" });
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  });

  it("after a correct answer, says the sentence and then moves to the next one", async () => {
    sentencesFromApi = [SENTENCE, SENTENCE_2];
    render(<SentenceGame />);
    const first = await screen.findByText(/Me gustan los (gatos|perros)\./);
    const isCats = first.textContent!.includes("gatos");
    const [answer, nextPrompt] = isCats
      ? [["I", "like", "cats"], "Me gustan los perros."]
      : [["I", "like", "dogs"], "Me gustan los gatos."];

    for (const w of answer) fireEvent.doubleClick(bankWord(w));
    fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
    const sentenceUtterance = lastUtterance!;

    // Still on the same sentence while it is being said.
    expect(screen.getByText("✅ Correct!", { exact: false })).toBeInTheDocument();
    act(() => sentenceUtterance.onend?.());

    await screen.findByText(nextPrompt, {}, { timeout: 2000 });
    expect(spoken.at(-1)).toEqual({ text: nextPrompt, lang: "es-ES" });

    // A late end event from the old sentence must not skip again.
    act(() => sentenceUtterance.onerror?.());
    await new Promise(r => setTimeout(r, 800));
    expect(screen.getByText(nextPrompt)).toBeInTheDocument();
  });

  it("Enter does the same as Check answer, only once every word is placed", async () => {
    render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByText("✅ Correct!", { exact: false })).toBeNull();

    for (const w of ["I", "like", "cats"]) fireEvent.doubleClick(bankWord(w));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("✅ Correct!", { exact: false })).toBeInTheDocument();
    expect(spoken.at(-1)).toEqual({ text: "I like cats.", lang: "en-US" });
    expect(screen.getByText("1/1")).toBeInTheDocument();

    // A second Enter must not count the answer again.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("1/1")).toBeInTheDocument();
  });

  it("Check answer has a visible background", async () => {
    render(<SentenceGame />);
    const btn = await screen.findByRole("button", { name: /Check answer/ });
    expect(btn.className).toContain("bg-[image:var(--grad-purple-green)]");
    expect(btn.className).not.toMatch(/bg-\[var\(--grad/);
  });

  it("a wrong answer does not move on", async () => {
    sentencesFromApi = [SENTENCE, SENTENCE_2];
    render(<SentenceGame />);
    const first = await screen.findByText(/Me gustan los (gatos|perros)\./);
    for (const w of ["like", "I"]) fireEvent.doubleClick(bankWord(w));
    fireEvent.doubleClick(screen.getAllByTitle("Drag, or double-click to place")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
    act(() => lastUtterance?.onend?.());
    await new Promise(r => setTimeout(r, 800));
    expect(screen.getByText(first.textContent!)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("✅ Correct!", { exact: false })).toBeNull());
  });

  it("double-click on a placed word sends it back; wrong order reads the learner's sentence", async () => {
    render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");
    for (const w of ["cats", "like", "I"]) fireEvent.doubleClick(bankWord(w));

    const placed = screen.getAllByTitle("Double-click to send back");
    fireEvent.doubleClick(placed[0]);
    expect(screen.getAllByTitle("Drag, or double-click to place")).toHaveLength(1);
    fireEvent.doubleClick(bankWord("cats"));

    fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
    expect(spoken.at(-1)).toEqual({ text: "cats like I", lang: "en-US" });
  });

  it("dropping a dragged word into a slot says it", async () => {
    const { container } = render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");
    fireEvent.dragStart(bankWord("like"));
    const firstSlot = container.querySelector("[draggable='false']")!;
    fireEvent.dragOver(firstSlot);
    fireEvent.drop(firstSlot);
    expect(spoken.at(-1)).toEqual({ text: "like", lang: "en-US" });
  });
});
