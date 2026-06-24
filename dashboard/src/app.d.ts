declare global {
	namespace App {
		interface Platform {
			env?: {
				WORKER?: { fetch: typeof fetch };
			};
		}
	}
}

export {};
