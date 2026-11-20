import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { collectVacancies } from "./collect.js";
import { readLocalConfig, setSourceDisabled } from "./local-config.js";
import { readSourceReports } from "./source-reports.js";
import { sources, wantApplyBotSource } from "./sources.js";
import { readVacancies, setVacancyStatus, type VacancyStatus } from "./store.js";

const app = express();
app.use(express.json());

app.get("/api/vacancies", async (request, response) => {
  const status = request.query.status;
  const vacancies = await readVacancies();
  response.json(status ? vacancies.filter((vacancy) => vacancy.status === status) : vacancies);
});

app.post("/api/vacancies/:id/status", async (request, response) => {
  const status = request.body?.status as VacancyStatus;
  if (!(["new", "liked", "rejected"] as string[]).includes(status)) return response.status(400).json({ error: "Unknown status" });
  const vacancy = await setVacancyStatus(request.params.id, status);
  return vacancy ? response.json(vacancy) : response.status(404).json({ error: "Vacancy not found" });
});

const allSources = [...sources, wantApplyBotSource];

/** Every configured source with its last collection report and the user's decisions on it. */
app.get("/api/sources", async (_request, response) => {
  const [reports, vacancies] = await Promise.all([readSourceReports(), readVacancies()]);
  const disabled = new Set(readLocalConfig().disabledSources ?? []);
  response.json(allSources.map((source) => {
    const own = vacancies.filter((vacancy) => vacancy.source === source.id);
    const count = (status: VacancyStatus) => own.filter((vacancy) => vacancy.status === status).length;
    return {
      id: source.id,
      name: source.name,
      url: source.url,
      enabled: !disabled.has(source.id),
      report: reports[source.id],
      queued: count("new"),
      liked: count("liked"),
      rejected: count("rejected"),
    };
  }));
});

app.post("/api/sources/:id/enabled", (request, response) => {
  const enabled = request.body?.enabled;
  if (typeof enabled !== "boolean") return response.status(400).json({ error: "enabled must be true or false" });
  if (!allSources.some((source) => source.id === request.params.id)) return response.status(404).json({ error: "Source not found" });
  setSourceDisabled(request.params.id, !enabled);
  return response.json({ id: request.params.id, enabled });
});

let collectionRunning = false;

/**
 * Streams collection progress as NDJSON: one CollectionEvent per line. A POST
 * with a streamed body (not EventSource) so a dropped connection never
 * silently restarts a collection.
 */
app.post("/api/collect", async (_request, response) => {
  if (collectionRunning) return response.status(409).json({ error: "Сбор уже идёт" });
  collectionRunning = true;
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  // If the tab is closed the collection still finishes: results are saved anyway.
  const send = (event: object): void => {
    if (!response.writableEnded && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
  };
  try {
    await collectVacancies(send);
  } catch (error: unknown) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    collectionRunning = false;
    if (!response.writableEnded) response.end();
  }
});

const webRoot = resolve("dist/web");
if (existsSync(webRoot)) app.use(express.static(webRoot));
app.get("/{*path}", (_request, response) => existsSync(webRoot) ? response.sendFile(resolve(webRoot, "index.html")) : response.status(404).send("Build the web app with pnpm build or use pnpm dev."));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`Worklooker API: http://localhost:${port}`));
