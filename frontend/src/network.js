function isLocalHost() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function getApiBaseCandidates() {
  const explicit = process.env.REACT_APP_API_BASE_URL;
  if (explicit) return [explicit];

  if (isLocalHost()) {
    return ['http://localhost:4000/api', 'https://auction-management.onrender.com/api'];
  }

  return ['https://auction-management.onrender.com/api', 'http://localhost:4000/api'];
}

export function getSocketUrl() {
  const explicit = process.env.REACT_APP_SOCKET_URL;
  if (explicit) return explicit;
  return isLocalHost() ? 'http://localhost:4000' : 'https://auction-management.onrender.com';
}

export async function requestJson(path, options = {}) {
  const bases = getApiBaseCandidates();
  let lastNetworkError = null;

  for (const base of bases) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    try {
      const response = await fetch(`${normalizedBase}${normalizedPath}`, options);
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : { error: await response.text() };

      if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      return payload;
    } catch (error) {
      if (error instanceof TypeError) {
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastNetworkError) {
    throw new Error('Unable to connect to auction server. Please start backend or set REACT_APP_API_BASE_URL.');
  }

  throw new Error('Request failed');
}
