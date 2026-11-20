export class HttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "сайт ограничил частоту запросов (HTTP 429), попробуйте позже" : `сайт вернул HTTP ${status}`);
  }
}

/** A page or API response as text; a non-2xx answer throws `HttpError`. */
export async function fetchText(url: string | URL, timeoutMs = 30_000): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new HttpError(response.status);
  return response.text();
}
