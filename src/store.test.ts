import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { RatedVacancy } from "./types.js";

// The store reads its folder when first imported: point it at a scratch one.
const directory = await mkdtemp(join(tmpdir(), "worklooker-store-"));
process.env.WORKLOOKER_DATA_DIR = directory;
const { mergeSourceVacancies, pruneInactiveSources, readVacancies, setVacancyStatus, vacancyId } = await import("./store.js");
const { serializedWith } = await import("./data-files.js");
type Saved = Awaited<ReturnType<typeof readVacancies>>[number];

after(() => rm(directory, { recursive: true, force: true }));

function rated(title: string, extra: Partial<RatedVacancy> = {}): RatedVacancy {
  return { source: "board", sourceName: "Board", title, url: `https://example.com/${encodeURIComponent(title)}`, snippet: "", remoteByDefault: true, fetchedAt: "2026-11-20T00:00:00.000Z", score: 11, reasons: [], ...extra };
}

function saved(title: string, status: Saved["status"], extra: Partial<RatedVacancy> = {}): Saved {
  const vacancy = rated(title, extra);
  return { ...vacancy, id: vacancyId(vacancy), status };
}

async function store(vacancies: Saved[]): Promise<void> {
  await writeFile(join(directory, "vacancies.json"), JSON.stringify(vacancies));
}

describe("store", () => {
  beforeEach(() => store([]));

  it("keeps a liked vacancy that looks like a digest", async () => {
    await store([saved("Вакансии за неделю: Tech Lead", "liked")]);
    await mergeSourceVacancies("other", []);
    assert.equal((await readVacancies()).length, 1);
  });

  it("drops an undecided digest", async () => {
    await store([saved("Вакансии за неделю", "new")]);
    await mergeSourceVacancies("other", []);
    assert.equal((await readVacancies()).length, 0);
  });

  it("treats legal forms as the same company", async () => {
    await store([saved("Tech Lead", "rejected", { company: "Acme Inc." })]);
    const { added } = await mergeSourceVacancies("board", [rated("Tech Lead", { company: "ACME" })]);
    assert.equal(added, 0);
    assert.deepEqual((await readVacancies()).map((vacancy) => vacancy.status), ["rejected"]);
  });

  it("does not queue a post already stored from another channel", async () => {
    const title = "Senior Frontend Engineer в Mad Devs";
    await store([saved(title, "rejected", { source: "channel-a" })]);
    const { added } = await mergeSourceVacancies("channel-b", [rated(title, { source: "channel-b" })]);
    assert.equal(added, 0);
  });

  it("keeps short titles from different channels apart", async () => {
    await store([saved("Tech Lead", "rejected", { source: "channel-a" })]);
    const { added } = await mergeSourceVacancies("channel-b", [rated("Tech Lead", { source: "channel-b" })]);
    assert.equal(added, 1);
  });

  it("keeps the first collection date when the source gives none", async () => {
    await mergeSourceVacancies("board", [rated("Tech Lead", { fetchedAt: "2026-11-01T00:00:00.000Z" })]);
    await mergeSourceVacancies("board", [rated("Tech Lead", { fetchedAt: "2026-11-20T00:00:00.000Z" })]);
    const [vacancy] = await readVacancies();
    assert.equal(vacancy.publishedAt, "2026-11-01T00:00:00.000Z");
    assert.equal(vacancy.publishedAtSource, "collector");
  });

  it("prefers the source's own date", async () => {
    await mergeSourceVacancies("board", [rated("Tech Lead")]);
    await mergeSourceVacancies("board", [rated("Tech Lead", { publishedAt: "2026-10-01T00:00:00.000Z", publishedAtSource: "source" })]);
    const [vacancy] = await readVacancies();
    assert.equal(vacancy.publishedAtSource, "source");
  });

  it("merges copies that turn out to be one vacancy, keeping the like", async () => {
    // An earlier version kept "Acme Inc." and "Acme" apart; the copy was rejected after the like.
    await store([
      { ...saved("Tech Lead", "liked", { company: "Acme Inc." }), id: "old-1" },
      { ...saved("Tech Lead", "rejected", { company: "Acme" }), id: "old-2" },
    ]);
    assert.deepEqual((await readVacancies()).map((vacancy) => vacancy.status), ["liked"]);
  });

  it("prunes undecided cards of inactive sources only", async () => {
    await store([saved("Tech Lead", "new", { source: "off" }), saved("Head of Frontend", "liked", { source: "off" }), saved("CTO", "new", { source: "on" })]);
    await pruneInactiveSources(new Set(["on"]));
    assert.deepEqual((await readVacancies()).map((vacancy) => vacancy.title).sort(), ["CTO", "Head of Frontend"]);
  });

  it("keeps a decision made while a collection writes", async () => {
    await store([saved("Tech Lead", "new")]);
    const [vacancy] = await readVacancies();
    await Promise.all([setVacancyStatus(vacancy.id, "liked"), mergeSourceVacancies("board", [rated("Tech Lead"), rated("CTO")])]);
    assert.equal((await readVacancies()).find((item) => item.title === "Tech Lead")?.status, "liked");
  });
});

it("file lock keeps two writers from losing each other's changes", async () => {
  // Two queues stand for two processes: only the file lock orders them.
  const counter = join(directory, "counter.txt");
  await writeFile(counter, "0");
  const increment = async () => {
    const value = Number(await readFile(counter, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(counter, String(value + 1));
  };
  const first = serializedWith("counter");
  const second = serializedWith("counter");
  await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second)(increment)));
  assert.equal(await readFile(counter, "utf8"), "10");
});
