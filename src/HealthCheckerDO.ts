export interface Env {
	DB: D1Database;

	worker_health_checks_latency: AnalyticsEngineDataset;

	worker_health_checks_errors: AnalyticsEngineDataset;

  worker_health_checks_locations: AnalyticsEngineDataset;
}

export interface HealthCheck {
	ID: string;
	Name: string;
	Target: string;
	Type: string;
	Method?: string; // GET, POST, PUT, DELETE
	ExpectedCodes?: string; // 200, 201, 202, 204
	ExpectedBodyContains?: string;
	CustomHeaders?: string;
	Status?: string;
	IsOnline?: number;
	LastCheck?: number;
	Active: number;
}

export class HealthCheckerDO {
    state: DurableObjectState
    env: Env
  
    constructor(state: DurableObjectState, env: Env) {
      this.state = state;
      this.env = env;
    }
  
    // Handle HTTP requests from clients.
    async fetch(request: Request) {
      var location = new URL(request.url).pathname;
      var logLocationCheck = this.getCheckLocation(location);
      var getAllChecks: HealthCheck[] = await request.json();
      console.log("Received " + getAllChecks.length + " checks, handling them... location: " + location);
      // Handle them asynchronously
      for (const check of getAllChecks) {
        try {
          await this.handleHealthCheck(this.env, check, location);
        } catch (e) {
          console.log(`Error handling health check ${check.Name}: ${e}`);
          console.log(e);
        }
      }
      await logLocationCheck;
      return Response.json({ message: "ok" });
    }
    async getCheckLocation(location: string): Promise<void> {
      const res = await fetch('https://cloudflare.com/cdn-cgi/trace')
      var text = await res.text();
      const arr = text.split("\n")
      const sliver = arr.filter(v => v.includes("sliver="))[0].split("sliver=")[1]
      const kex = arr.filter(v => v.includes("kex="))[0].split("kex=")[1]
      const colo = arr.filter(v => v.includes("colo="))[0].split("colo=")[1]
        this.env.worker_health_checks_locations.writeDataPoint({
        'blobs': [sliver, kex, colo],
        'doubles': [1],
        'indexes': [location]
      });
      console.log(`Call to ${location} was handled by ${sliver} in ${kex} at ${colo}`)
    }
    async handleHealthCheck(env: Env, healthCheck: HealthCheck, location: string) {
      console.log("Handling health check: " + healthCheck.Name);
      // Handle custom headers
      let newHeaders = new Headers();
      healthCheck?.CustomHeaders?.split(";").map((element: any) => {
        const header = element.split(":");
        let key = header[0].trim();
        let value = header[1].trim();
        newHeaders.append(key, value);
      });
      // Default User-Agent header
      if (newHeaders.get("User-Agent") == null)
        newHeaders.append("User-Agent", "Cloudflare Health Check Worker / 0.0.1");
  
      // Sub-request
      const subRequestObj = {
        method: healthCheck.Method || "GET",
        headers: newHeaders,
      };
      var subRequest = new Request(healthCheck.Target, subRequestObj);
      const requestStartTime = Date.now();
      var subResponse = await fetch(subRequest);
      const requestTime = Math.round(Date.now() - requestStartTime);
  
      console.log(`SubRequest to ${healthCheck.Target} took ${requestTime}ms`);
      // Default expected codes
      var allowedCodes = [
        200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304,
        305, 306, 307, 308,
      ];
      // Custom codes
      if (healthCheck.ExpectedCodes != null) {
        allowedCodes = healthCheck.ExpectedCodes.split(",").map(
          (element: any) => {
            return parseInt(element);
          }
        );
      }
      // Check if the body contains the expected string, if set
      var bodyCheckSuccess = true;
      if (healthCheck.ExpectedBodyContains != null) {
        var body = await subResponse.text();
        bodyCheckSuccess = body.includes(healthCheck.ExpectedBodyContains);
      }
  
      // Check if the status code is right and the body contains the expected string
      if (allowedCodes.includes(subResponse.status) && bodyCheckSuccess) {
        // success
        console.log(
          `Health check ${healthCheck.Name} succeeded with status ${subResponse.status}`
        );
        // Update the health check
        /* Disabled for now, D1 seems pretty broken within DOs
        await env.DB.prepare(
          "Update health_checks Set LastCheck = datetime('now'), Status = 'OK', IsOnline = 1 where ID = ?"
        )
          .bind(healthCheck.ID)
          .run();
          */
        // Insert latency
        env.worker_health_checks_latency.writeDataPoint({
          blobs: [subResponse.status.toString(), location],
          doubles: [requestTime],
          indexes: [healthCheck.Name],
        });
      } else {
        // failure
        console.log(
          `Health check ${healthCheck.Name} failed with status ${subResponse.status}, body check success: ${bodyCheckSuccess}`
        );
        // Update the health check
                /* Disabled for now, D1 seems pretty broken within DOs
        await env.DB.prepare(
          "Update health_checks Set LastCheck = datetime('now'), Status = ?, IsOnline = 0 where ID = ?"
        )
          .bind(subResponse.status, healthCheck.ID)
          .run();
          */
        // Insert latency
        env.worker_health_checks_errors.writeDataPoint({
          blobs: [subResponse.status.toString(), location],
          doubles: [1, requestTime],
          indexes: [healthCheck.Name],
        });
      }
    }
  }
  