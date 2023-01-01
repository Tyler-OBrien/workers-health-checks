import { HealthCheck } from "./HealthCheckerDO";

export { HealthCheckerDO } from "./HealthCheckerDO";

export default {
  async scheduled(
    controller: ScheduledController | null,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log("Hello from scheduled worker!");

    const db = env.DB;
    // Get all active health checks
    var checks: D1Result<HealthCheck> = await db
      .prepare("Select * from health_checks where Active = 1")
      .bind()
      .all();

    const init = {
      body: JSON.stringify(checks.results),
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
      },
    };

	//https://developers.cloudflare.com/workers/runtime-apis/durable-objects/#providing-a-location-hint
    let regions = [
      "wnam",
      "enam",
      "sam",
      "weur",
      "eeur",
      "apac",
      "oc",
      "afr",
      "me",
    ];
    let taskList = [];

    for (const region of regions) {
      console.log(`Requesting ${region}...`);
	  // We're using a random GUID so we don't just stick to a single location and instead spread out across colos in the region. This may not be preferrable, and also forces Cloudflare to create a new Durable Object instance on each request.
      let id = env.HEALTHCHECKER.idFromName(crypto.randomUUID());
      const stubby = env.HEALTHCHECKER.get(id, { locationHint: region });
      var task = stubby.fetch(
        new Request("https://literallyanything/" + region, init)
      );
      taskList.push(task);
    }
    await Promise.all(taskList);
  },
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Make sure to disable public  worker.dev access to this endpoint!
    // This is just for testing purposes
    await this.scheduled(null, env, ctx);
    return Response.json({ message: "ok" });
  },
};

export interface Env {
  DB: D1Database;

  worker_health_checks_latency: AnalyticsEngineDataset;

  worker_health_checks_errors: AnalyticsEngineDataset;

  HEALTHCHECKER: DurableObjectNamespace;
}
