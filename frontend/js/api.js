// Thin fetch wrappers, one per endpoint. URLs are relative, so the page works from
// whatever host/port (or reverse proxy) is serving it.
const Api = (() => {
  async function request(method, url, body) {
    let res;
    try {
      res = await fetch((window.ECO_API_BASE || '') + url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Cannot reach the server');
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Server returned a non-JSON response (HTTP ' + res.status + ')');
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'Request failed (HTTP ' + res.status + ')');
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    getGraph: () => request('GET', 'graph'),
    getSchedule: () => request('GET', 'schedule'),
    postRoute: (homeIds, mode) => request('POST', 'route', { homeIds, mode }),
    postClassify: (description) => request('POST', 'classify', { description }),
    postRouteHazard: (locationId) => request('POST', 'route/hazard', { locationId }),
    postCollect: (ids) => request('POST', 'collect', { ids }),
    getSimulation: () => request('GET', 'simulation'),
    // params: { days, autoCollect, mode, normalTrucks, normalCapacity, hazardTrucks }
    advance: (params) => request('POST', 'simulate/advance', params),
    resetSimulation: () => request('POST', 'simulate/reset', {}),
    getDatabase: () => request('GET', 'database'),
    // params: { type: 'home'|'bin'|'junction', count, hazardous, seed? }
    generateNodes: (params) => request('POST', 'nodes/generate', params),
    // params: { type: 'home'|'bin'|'junction', count, hazardous } - removes the newest ADDED nodes
    removeNodes: (params) => request('POST', 'nodes/remove', params),
  };
})();
