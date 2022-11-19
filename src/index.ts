export interface Env {
	DB: D1Database;

	worker_health_checks_latency: AnalyticsEngineDataset;

	worker_health_checks_errors: AnalyticsEngineDataset;
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

export default {
	 //Just for easier testing
	 /*
	async fetch(
	  controller: ScheduledController,
	  env: Env,
	  ctx: ExecutionContext
	): Promise<Response> {
	  await this.scheduled(controller, env, ctx);
	  return Response.json({ message: "ok" });
	},
  */

	async scheduled(
		controller: ScheduledController,
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
		// Handle them asynchronously
		for (const check of checks?.results) {
			try {
				await this.handleHealthCheck(env, check);
			} catch (e) {
				console.log(`Error handling health check ${check.Name}: ${e}`);
				console.log(e);
			}
		}
	},
	async handleHealthCheck(env: Env, healthCheck: HealthCheck) {
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
			await env.DB.prepare(
				"Update health_checks Set LastCheck = datetime('now'), Status = 'OK', IsOnline = 1 where ID = ?"
			)
				.bind(healthCheck.ID)
				.run();
			// Insert latency
			env.worker_health_checks_latency.writeDataPoint({
				blobs: [subResponse.status.toString()],
				doubles: [requestTime],
				indexes: [healthCheck.Name],
			});
		} else {
			// failure
			console.log(
				`Health check ${healthCheck.Name} failed with status ${subResponse.status}, body check success: ${bodyCheckSuccess}`
			);
			// Update the health check
			await env.DB.prepare(
				"Update health_checks Set LastCheck = datetime('now'), Status = ?, IsOnline = 0 where ID = ?"
			)
				.bind(subResponse.status, healthCheck.ID)
				.run();
			// Insert latency
			env.worker_health_checks_errors.writeDataPoint({
				blobs: [subResponse.status.toString()],
				doubles: [1, requestTime],
				indexes: [healthCheck.Name],
			});
		}
	},
};
