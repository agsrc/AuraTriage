import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface TracingConfig {
  enabled: boolean;
  /** Full OTLP/HTTP traces URL. Phoenix listens on http://localhost:6006/v1/traces. */
  endpoint: string;
  serviceName: string;
}

export interface Tracing {
  enabled: boolean;
  /** Sends any spans still waiting to be exported. Safe to call when tracing is off. */
  shutdown(): Promise<void>;
}

/**
 * Starts OpenTelemetry export when `OTEL_ENABLED=true`, otherwise does nothing. Spans carry only
 * the attributes allowed by `SafeAttributes`, so this is separate from the LangSmith switches,
 * which stay forced off: LangSmith is a hosted service and would receive patient messages.
 */
export function initTracing(config: TracingConfig): Tracing {
  if (!config.enabled) {
    return { enabled: false, shutdown: async () => undefined };
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      // Phoenix groups traces into projects by this resource attribute.
      "openinference.project.name": config.serviceName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: config.endpoint, timeoutMillis: 5000 })),
    ],
  });
  // Also installs the async context manager that links node spans to the turn that started them.
  provider.register();
  return { enabled: true, shutdown: () => provider.shutdown() };
}
