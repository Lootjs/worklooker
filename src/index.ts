import { mkdir, writeFile } from "node:fs/promises";
import { collectVacancies } from "./collect.js";
import { dataDirectory, dataPath } from "./data-files.js";
import { readProfile } from "./local-config.js";

async function main(): Promise<void> {
  // Each source is saved to data/vacancies.json as soon as it finishes.
  const { vacancies: rated, errors } = await collectVacancies((event) => {
    if (event.type === "source") console.log(`[${event.done}/${event.total}] ${event.sourceName}: ${event.error ? `ошибка — ${event.error}` : `подходящих ${event.matched}, новых ${event.added}`}`);
  });

  await mkdir(dataDirectory, { recursive: true });
  const generatedAt = new Date().toISOString();
  const failures = errors.map((error) => `${error.sourceName}: ${error.message}`);
  await writeFile(dataPath("latest.json"), JSON.stringify({ generatedAt, profile: readProfile().profile, vacancies: rated, errors }, null, 2));
  const lines = [
    "# Подходящие вакансии",
    "",
    `Обновлено: ${generatedAt}`,
    "",
    ...rated.flatMap((vacancy) => [
      `## ${vacancy.title}${vacancy.company ? ` — ${vacancy.company}` : ""}`,
      `**${vacancy.sourceName} · ${vacancy.score}/?** — ${vacancy.reasons.join("; ")}`,
      vacancy.snippet,
      vacancy.url,
      "",
    ]),
    ...(failures.length ? ["## Недоступные источники", "", ...failures.map((failure) => `- ${failure}`), ""] : []),
  ];
  await writeFile(dataPath("latest.md"), lines.join("\n"));
  console.log(`Найдено подходящих вакансий: ${rated.length}. Результат: ${dataPath("latest.md")}`);
  if (failures.length) console.warn(`Ошибки источников: ${failures.join(" | ")}`);
}

void main();
