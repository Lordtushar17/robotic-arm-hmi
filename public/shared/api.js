// One place for talking to the Raspberry Pi server.
// Endpoints: GET /api/status, GET/POST /api/poses, DELETE /api/poses/:id, POST /api/transcribe
export async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: { ...(options.headers || {}) }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}
