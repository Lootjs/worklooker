import assert from "node:assert/strict";
import { it } from "node:test";
import { SourceTally } from "./source-reports.js";
import type { Vacancy } from "./types.js";

function vacancy(url: string, title = "Tech Lead"): Vacancy {
  return { source: "test", sourceName: "Test", title, url, snippet: "", remoteByDefault: true, fetchedAt: "2026-11-20T00:00:00.000Z" };
}

it("counts each vacancy once, by its last verdict", () => {
  const tally = new SourceTally();
  const passed = vacancy("https://example.com/1");
  tally.record(passed, { vacancy: { ...passed, score: 11, reasons: [] } });
  tally.record(vacancy("https://example.com/2", "Backend Developer"), { dropped: "notTargetRole" });
  // Rated again after the full description was fetched: the later verdict counts.
  const reRated = vacancy("https://example.com/3");
  tally.record(reRated, { vacancy: { ...reRated, score: 11, reasons: [] } });
  tally.record(reRated, { dropped: "russia", detail: "ТК РФ" });
  tally.record(vacancy("https://example.com/4"), { dropped: "stale" });

  const report = tally.report("test", 1, 1);
  assert.equal(report.found, 4);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.dropped, {
    notTargetRole: { count: 1, examples: [{ title: "Backend Developer", url: "https://example.com/2" }] },
    russia: { count: 1, examples: [{ title: "Tech Lead", url: "https://example.com/3", detail: "ТК РФ" }] },
    stale: { count: 1, examples: [{ title: "Tech Lead", url: "https://example.com/4" }] },
  });
});
