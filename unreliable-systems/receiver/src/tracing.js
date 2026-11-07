// @ts-check
import { context, propagation, trace } from '@opentelemetry/api';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';

/** @type {string} */
let serviceName = 'receiver';

export function startTracing(name) {
  serviceName = name;
  const provider = new TracerProvider({
    resource: defaultResource().merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: name,
    })),
    // Simple, not batch. A batch can still be in memory when you read the logs of a request that just finished.
    spanProcessors: [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })],
  });
  trace.setGlobalTracerProvider(provider);
  // The stack manager only follows synchronous calls. A retry after await would start a second trace.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new CompositePropagator({
    propagators: [new W3CTraceContextPropagator()],
  }));
  return provider;
}

export function tracer() {
  return trace.getTracer(serviceName);
}

/**
 * @param {import('@opentelemetry/api').Span} span
 * @param {Record<string, unknown>} fields
 */
export function logEvent(span, fields) {
  const ctx = span.spanContext();
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    service: serviceName,
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    ...fields,
  }));
}
