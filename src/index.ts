import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectVacancies } from "./collect.js";

async function main(): Promise<void> {
  // Each source is saved to data/vacancies.json as soon as it finishes.
  const { vacancies: rated, errors } = await collectVacancies((event) => {
    if (event.type === "source") console.log(`[${event.done}/${event.total}] ${event.sourceName}: ${event.error ? `ошибка — ${event.error}` : `подходящих ${event.matched}, новых ${event.added}`}`);
  });

  await mkdir("data", { recursive: true });
  const generatedAt = new Date().toISOString();
  await writeFile(join("data", "latest.json"), JSON.stringify({ generatedAt, profile: "frontend leadership, remote", vacancies: rated, errors }, null, 2));
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
    ...(errors.length ? ["## Недоступные источники", "", ...errors.map((error) => `- ${error}`), ""] : []),
  ];
  await writeFile(join("data", "latest.md"), lines.join("\n"));
  console.log(`Найдено подходящих вакансий: ${rated.length}. Результат: data/latest.md`);
  if (errors.length) console.warn(`Ошибки источников: ${errors.join(" | ")}`);
}

void main();
