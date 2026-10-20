import { Config, Env, Nested } from '../decorators';

@Config
class PostHogConfig {
	/** PostHog project API key for product analytics. Empty disables the client. */
	@Env('N8N_DIAGNOSTICS_POSTHOG_API_KEY')
	apiKey: string = '';

	/** PostHog API host URL. Points to a non-routable loopback so no events leave the instance. */
	@Env('N8N_DIAGNOSTICS_POSTHOG_API_HOST')
	apiHost: string = 'http://127.0.0.1:1';
}

@Config
export class DiagnosticsConfig {
	/** Whether anonymous diagnostics and telemetry are enabled for this instance. */
	@Env('N8N_DIAGNOSTICS_ENABLED')
	enabled: boolean = false;

	/** Telemetry endpoint config for the frontend (format: key;baseUrl). */
	@Env('N8N_DIAGNOSTICS_CONFIG_FRONTEND')
	frontendConfig: string = 'disabled;http://127.0.0.1:1';

	/** Telemetry endpoint config for the backend (format: key;baseUrl). */
	@Env('N8N_DIAGNOSTICS_CONFIG_BACKEND')
	backendConfig: string = 'disabled;http://127.0.0.1:1';

	@Nested
	posthogConfig: PostHogConfig;
}
