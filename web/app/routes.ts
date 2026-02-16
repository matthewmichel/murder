import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("providers", "routes/providers.tsx"),
  route("configs", "routes/configs.tsx"),
  route("agents", "routes/agents.tsx"),
  route("projects", "routes/projects.tsx"),
  route("jobs", "routes/jobs.tsx"),
] satisfies RouteConfig;
