import assert from "node:assert/strict";
import { it } from "node:test";
import { SourceTally } from "./source-reports.js";
import type { Vacancy } from "./types.js";

function vacancy(url: string, title = "Tech Lead"): Vacancy {
  return { source: "test", sourceName: "Test", title, url, snippet: "", remoteByDefault: true, fetchedAt: "2026-11-20T00:00:00.000Z" };
}

const passed = (item: Vacancy) => ({ vacancy: { ...item, score: 11, reasons: [] } });

it("counts each vacancy once, by its last verdict", () => {
  const tally = new SourceTally();
  tally.record(vacancy("https://example.com/1"), passed(vacancy("https://example.com/1")));
  tally.record(vacancy("https://example.com/2", "Backend Developer"), { dropped: "notTargetRole" });
  // Rated again after the full description was fetched: the later verdict counts.
  const reRated = vacancy("https://example.com/3");
  tally.record(reRated, passed(reRated));
  tally.record(reRated, { dropped: "russia", detail: "ТК РФ" });
  tally.record(vacancy("https://example.com/4"), { dropped: "stale" });

  const report = tally.report("test", 1);
  assert.equal(report.found, 4);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.dropped, {
    notTargetRole: { count: 1, examples: [{ title: "Backend Developer", url: "https://example.com/2" }] },
    russia: { count: 1, examples: [{ title: "Tech Lead", url: "https://example.com/3", detail: "ТК РФ" }] },
    stale: { count: 1, examples: [{ title: "Tech Lead", url: "https://example.com/4" }] },
  });
});

it("tells apart vacancies that share a link", () => {
  // Bot messages without a button all link to the bot chat.
  const tally = new SourceTally();
  for (const title of ["Tech Lead", "Head of Frontend", "QA Engineer"]) {
    const item = vacancy("https://t.me/wantapply_bot", title);
    tally.record(item, title === "QA Engineer" ? { dropped: "notTargetRole" } : passed(item));
  }
  const report = tally.report("bot", 2);
  assert.equal(report.found, 3);
  assert.equal(report.matched, 2);
});
