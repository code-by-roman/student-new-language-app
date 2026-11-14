import { fireEvent, render, screen } from "@testing-library/react";
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

let spoken: { text: string; lang: string }[] = [];

beforeEach(() => {
  spoken = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sentences: [SENTENCE] }) })));
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    lang = ""; rate = 1; pitch = 1;
    constructor(public text: string) {}
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { cancel: vi.fn(), speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }) },
  });
});

const bankWord = (w: string) => screen.getAllByTitle("Drag, or double-click to place").find(el => el.textContent?.startsWith(w))!;

describe("SentenceGame speech and double-click", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByText("✅ Correct!", { exact: false })).toBeInTheDocument();
    expect(spoken.at(-1)).toEqual({ text: "I like cats.", lang: "en-US" });
  });

  it("double-click on a placed word sends it back; wrong order reads the learner's sentence", async () => {
    render(<SentenceGame />);
    await screen.findByText("Me gustan los gatos.");
    for (const w of ["cats", "like", "I"]) fireEvent.doubleClick(bankWord(w));

    const placed = screen.getAllByTitle("Double-click to send back");
    fireEvent.doubleClick(placed[0]);
    expect(screen.getAllByTitle("Drag, or double-click to place")).toHaveLength(1);
    fireEvent.doubleClick(bankWord("cats"));

    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
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
