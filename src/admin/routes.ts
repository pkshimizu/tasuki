/**
 * 管理画面の API の道と、その内容。
 */
import { buildApp, buildDashboard } from "./dashboard.js";
import { buildRequirement, buildRequirements } from "./requirements.js";
import { type AdminRoutes, NOT_FOUND } from "./server.js";
import {
  buildActivity,
  buildProduct,
  buildPullRequest,
  buildPullRequests,
  buildQuestions,
  buildSystem,
  type ViewSources,
} from "./views.js";

export function adminRoutes(sources: ViewSources): AdminRoutes {
  return (path) => {
    switch (path) {
      case "/api/app":
        return buildApp(sources);
      case "/api/dashboard":
        return buildDashboard(sources);
      case "/api/requirements":
        return buildRequirements(sources);
      case "/api/prs":
        return buildPullRequests(sources);
      case "/api/activity":
        return buildActivity(sources);
      case "/api/questions":
        return buildQuestions(sources);
      case "/api/product":
        return buildProduct(sources);
      case "/api/system":
        return buildSystem(sources);
    }
    const pr = /^\/api\/prs\/(\d{1,9})$/.exec(path);
    if (pr) return buildPullRequest(sources, Number(pr[1])) ?? NOT_FOUND;
    const req = /^\/api\/requirements\/([^/]{1,100})$/.exec(path);
    if (req) {
      let id: string;
      try {
        id = decodeURIComponent(req[1] ?? "");
      } catch {
        return NOT_FOUND;
      }
      return buildRequirement(sources, id) ?? NOT_FOUND;
    }
    return NOT_FOUND;
  };
}
