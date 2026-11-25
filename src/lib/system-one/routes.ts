export const systemOneRoutes = {
  models: { method: "GET", path: "/v1/models" },
  decide: { method: "POST", path: "/v1/systemone" },
  decideByPipeline: { method: "POST", path: "/system-one/decide-by-pipeline" },
} as const;

export const apiBasePath = "/api";
