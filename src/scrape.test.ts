import assert from "node:assert/strict";
import { it } from "node:test";
import { formatVacancyText } from "./scrape.js";
import { digestPattern } from "./text.js";

it("removes only the opening title from the description", () => {
  const post = "#vacancy Frontend Lead в Acme 📍Remote\nМы ищем Frontend Lead в Acme, который возглавит команду.";
  const { title, snippet } = formatVacancyText(post, "Channel");
  assert.equal(title, "Frontend Lead в Acme");
  assert.match(snippet, /Мы ищем Frontend Lead в Acme, который/);
});

it("takes the author out of the title", () => {
  const { title, author } = formatVacancyText("Алла Клименко Senior Frontend Engineer в Mad Devs 📍Remote", "Channel");
  assert.equal(author, "Алла Клименко");
  assert.equal(title, "Senior Frontend Engineer в Mad Devs");
});

it("recognises digests in Russian and English", () => {
  assert.ok(digestPattern.test("Подборка вакансий за неделю"));
  assert.ok(digestPattern.test("Свежие роли #дайджест"));
  assert.ok(!digestPattern.test("Вакансия: Tech Lead#digestive"));
});
