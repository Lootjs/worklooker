import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MatchProfile } from "./local-config.js";
import { createRater, type MatchVerdict } from "./match.js";
import type { Vacancy } from "./types.js";

const profile: MatchProfile = {
  roles: ["frontend lead", "tech lead", "руководител* разработки", "техлид*", "тимлид*"],
  field: ["frontend", "front-end", "фронтенд*", "full-stack"],
  seniority: ["senior", "lead", "head", "руководител", "ведущ"],
  skills: ["TypeScript", "Vue"],
  remoteOnly: true,
  preferRussian: true,
  minScore: 6,
  excludeRoles: ["junior", "intern", "стажёр*", "младш*", "middle"],
  blockers: ["гемблинг*", "casino"],
  excludeRussia: true,
};

function vacancy(title: string, snippet = "", extra: Partial<Vacancy> = {}): Vacancy {
  return { source: "test", sourceName: "Test", title, url: "https://example.com/1", snippet, remoteByDefault: true, fetchedAt: "2026-11-20T00:00:00.000Z", ...extra };
}

const rate = createRater(profile);
const dropped = (verdict: MatchVerdict) => "dropped" in verdict ? verdict.dropped : undefined;

describe("createRater", () => {
  it("keeps a remote target role", () => {
    const verdict = rate(vacancy("Frontend Lead / Архитектор", "Vue 3, TypeScript"));
    assert.ok("vacancy" in verdict);
    assert.ok(verdict.vacancy.reasons.includes("целевая роль"));
  });

  it("reads target roles from the title only", () => {
    assert.equal(dropped(rate(vacancy("Backend Developer", "You will report to our Tech Lead"))), "notTargetRole");
  });

  it("drops a vacancy that is not remote when remote is required", () => {
    assert.equal(dropped(rate(vacancy("Tech Lead", "Office in Limassol", { remoteByDefault: false, remote: false }))), "notRemote");
  });

  describe("excluded roles", () => {
    it("drop by the title", () => {
      assert.deepEqual(rate(vacancy("Junior Front-End Software Engineer")), { dropped: "excludedRole", detail: "Junior" });
      assert.equal(dropped(rate(vacancy("Младший руководитель разработки"))), "excludedRole");
    });

    it("ignore the description", () => {
      assert.ok("vacancy" in rate(vacancy("Tech Lead", "Вы будете наставником для junior-разработчиков")));
    });
  });

  describe("Russia", () => {
    const signs = [
      "Формат работы: удалёнка из РФ с оформлением по ТК РФ",
      "Удалённо по России, полный день",
      "Работа на территории РФ",
      "Только для резидентов РФ",
      "Аккредитованная IT-компания, разрабатывающая собственные продукты",
      "ДМС после испытательного срока",
      "Белая зарплата, официальное трудоустройство",
      "Есть офис в Санкт-Петербурге",
      "Резидент Сколково",
      "ООО «Ромашка»",
    ];
    for (const sign of signs) {
      it(`drops «${sign}»`, () => assert.equal(dropped(rate(vacancy("Техлид frontend", sign))), "russia"));
    }

    it("keeps Russian-speaking companies abroad and rouble salaries", () => {
      for (const snippet of ["Русскоязычная команда, офис на Кипре", "Зарплата 300 000 руб.", "Удалённо из любой страны, кроме РФ и РБ"]) {
        assert.ok("vacancy" in rate(vacancy("Тимлид фронтенда", snippet)), snippet);
      }
    });

    it("is off unless the profile asks for it", () => {
      assert.ok("vacancy" in createRater({ ...profile, excludeRussia: false })(vacancy("Tech Lead", "Работа по ТК РФ")));
    });

    it("does not treat an exclamation as a legal form", () => {
      assert.ok("vacancy" in rate(vacancy("Tech Lead", "Ооо, какая команда!")));
    });
  });

  describe("USA", () => {
    const rateUsa = createRater({ ...profile, excludeRussia: false, excludeUSA: true });
    const signs = [
      "Remote · USA · Applicants from: USA · USD 204000-290000 / year",
      "Senior Frontend Engineer (Remote - US)",
      "This role is US only.",
      "You must be based in the United States.",
      "Candidates must be authorized to work in the U.S. without sponsorship.",
      "Requires US citizenship and an active security clearance.",
      "You must be US-based to apply.",
      "Удалённо только из США",
    ];
    for (const sign of signs) {
      it(`drops «${sign}»`, () => assert.equal(dropped(rateUsa(vacancy("Tech Lead", sign))), "usa"));
    }

    it("keeps American employers hiring worldwide", () => {
      for (const snippet of [
        "We are a US-based company hiring across Europe.",
        "Lead technical discussions with US-based clients.",
        "Join us remotely from anywhere.",
        "Headquartered in San Francisco, fully remote worldwide.",
      ]) {
        assert.ok("vacancy" in rateUsa(vacancy("Tech Lead", snippet)), snippet);
      }
    });

    it("is off unless the profile asks for it", () => {
      assert.ok("vacancy" in rate(vacancy("Tech Lead", "Applicants from: USA")));
    });
  });

  it("drops a blocker anywhere in the text", () => {
    assert.deepEqual(rate(vacancy("Tech Lead", "Мы делаем продукты для гемблинга")), { dropped: "blocker", detail: "гемблинга" });
  });

  it("reports a low score", () => {
    assert.equal(dropped(createRater({ ...profile, minScore: 100 })(vacancy("Tech Lead"))), "lowScore");
  });
});
