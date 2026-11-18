import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { collectVacancies } from "./collect.js";
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
