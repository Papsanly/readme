import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  PdfRenderError,
  registerPdfRenderer,
  type PdfRendererImpl,
  type PdfRendererJob
} from '@/src/pipeline/pdf';

const PDFJS_LIB_PLACEHOLDER = '/*__PDFJS_LIB__*/';
const PDFJS_WORKER_PLACEHOLDER = '/*__PDFJS_WORKER__*/';

const HTML_MODULE = require('../../../assets/pdfjs/index.html');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFJS_LIB_MODULE = require('../../../assets/pdfjs/pdf.min.mjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFJS_WORKER_MODULE = require('../../../assets/pdfjs/pdf.worker.min.mjs');

type GuestPageMessage = {
  type: 'page';
  pageNumber: number;
  total: number;
  dataUrl: string;
};
type GuestDoneMessage = { type: 'done'; total: number };
type GuestErrorMessage = { type: 'error'; message: string };
type GuestReadyMessage = { type: 'ready' };
type GuestMessage = GuestPageMessage | GuestDoneMessage | GuestErrorMessage | GuestReadyMessage;

type HostInitMessage = {
  type: 'init';
  pdfBase64: string;
  scale: number;
};

async function loadAssetText(moduleId: number): Promise<string> {
  const [asset] = await Asset.loadAsync(moduleId);
  if (!asset || !asset.localUri) {
    throw new PdfRenderError(`Failed to resolve bundled asset (module ${moduleId})`);
  }
  return new File(asset.localUri).text();
}

function buildHtml(template: string, libCode: string, workerCode: string): string {
  if (!template.includes(PDFJS_LIB_PLACEHOLDER)) {
    throw new PdfRenderError(`pdf.js HTML template missing ${PDFJS_LIB_PLACEHOLDER}`);
  }
  if (!template.includes(PDFJS_WORKER_PLACEHOLDER)) {
    throw new PdfRenderError(`pdf.js HTML template missing ${PDFJS_WORKER_PLACEHOLDER}`);
  }
  // Use the function form of `replace` so the minified pdf.js bytes — which
  // contain `$&`, `$$`, `$1` etc. as legitimate JS — are not reinterpreted as
  // replacement-pattern tokens by `String.prototype.replace`.
  return template
    .replace(PDFJS_LIB_PLACEHOLDER, () => libCode)
    .replace(PDFJS_WORKER_PLACEHOLDER, () => workerCode);
}

function parseGuestMessage(raw: string): GuestMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as { type?: unknown };
  switch (obj.type) {
    case 'page': {
      const m = parsed as Record<string, unknown>;
      if (
        typeof m.pageNumber === 'number' &&
        typeof m.total === 'number' &&
        typeof m.dataUrl === 'string'
      ) {
        return {
          type: 'page',
          pageNumber: m.pageNumber,
          total: m.total,
          dataUrl: m.dataUrl
        };
      }
      return null;
    }
    case 'done': {
      const m = parsed as Record<string, unknown>;
      if (typeof m.total === 'number') return { type: 'done', total: m.total };
      return null;
    }
    case 'error': {
      const m = parsed as Record<string, unknown>;
      const message = typeof m.message === 'string' ? m.message : 'Unknown WebView error';
      return { type: 'error', message };
    }
    case 'ready':
      return { type: 'ready' };
    default:
      return null;
  }
}

/** Off-screen WebView that hosts pdf.js and processes queued render jobs FIFO. */
export function PdfRendererHost(): React.ReactElement {
  const webviewRef = useRef<WebView>(null);
  const queueRef = useRef<PdfRendererJob[]>([]);
  const currentJobRef = useRef<PdfRendererJob | null>(null);
  const guestReadyRef = useRef(false);
  const [html, setHtml] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null);

  const failCurrent = useCallback((err: Error) => {
    const job = currentJobRef.current;
    currentJobRef.current = null;
    if (job) {
      try {
        job.onError(err);
      } catch (cbErr) {
        console.warn(
          `[pdf-host] job.onError threw: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`
        );
      }
    }
  }, []);

  const dispatchNext = useCallback((): void => {
    if (currentJobRef.current) return;
    if (!guestReadyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    currentJobRef.current = next;

    void (async () => {
      try {
        const file = new File(next.pdfUri);
        if (!file.exists) {
          throw new PdfRenderError(`PDF not found at ${next.pdfUri}`);
        }
        const pdfBase64 = await file.base64();
        const message: HostInitMessage = {
          type: 'init',
          pdfBase64,
          scale: next.scale
        };
        const wv = webviewRef.current;
        if (!wv) {
          throw new PdfRenderError('WebView ref unavailable when dispatching init');
        }
        wv.postMessage(JSON.stringify(message));
      } catch (err) {
        failCurrent(err instanceof Error ? err : new PdfRenderError('Failed to dispatch job'));
        // Continue draining the queue — others might still be runnable.
        setTimeout(dispatchNext, 0);
      }
    })();
  }, [failCurrent]);

  const run = useCallback(
    (job: PdfRendererJob) => {
      queueRef.current.push(job);
      dispatchNext();
    },
    [dispatchNext]
  );

  const impl = useMemo<PdfRendererImpl>(() => ({ run }), [run]);

  // Load and template the HTML once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [template, libCode, workerCode] = await Promise.all([
          loadAssetText(HTML_MODULE),
          loadAssetText(PDFJS_LIB_MODULE),
          loadAssetText(PDFJS_WORKER_MODULE)
        ]);
        if (cancelled) return;
        setHtml(buildHtml(template, libCode, workerCode));
      } catch (err) {
        if (cancelled) return;
        const wrapped =
          err instanceof Error ? err : new PdfRenderError('Unknown error loading pdf.js assets');
        setBootstrapError(wrapped);
        console.error(`[pdf-host] failed to bootstrap pdf.js assets: ${wrapped.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Register with the bus once the HTML is ready (the WebView may still be loading,
  // but jobs that arrive before `ready` will be queued and flushed on guest-ready).
  useEffect(() => {
    if (!html) return;
    const unregister = registerPdfRenderer(impl);
    return unregister;
  }, [html, impl]);

  // Surface bootstrap failures to any in-flight or queued jobs.
  useEffect(() => {
    if (!bootstrapError) return;
    const drain = (): void => {
      const jobs = queueRef.current.splice(0, queueRef.current.length);
      for (const job of jobs) {
        try {
          job.onError(bootstrapError);
        } catch (err) {
          console.warn(
            `[pdf-host] job.onError threw during bootstrap-fail drain: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      if (currentJobRef.current) failCurrent(bootstrapError);
    };
    drain();
  }, [bootstrapError, failCurrent]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const parsed = parseGuestMessage(event.nativeEvent.data);
      if (!parsed) return;

      switch (parsed.type) {
        case 'ready': {
          guestReadyRef.current = true;
          dispatchNext();
          return;
        }
        case 'page': {
          const job = currentJobRef.current;
          if (!job) return;
          try {
            job.onPage(parsed.pageNumber, parsed.total, parsed.dataUrl);
          } catch (err) {
            failCurrent(err instanceof Error ? err : new PdfRenderError('onPage callback threw'));
          }
          return;
        }
        case 'done': {
          const job = currentJobRef.current;
          currentJobRef.current = null;
          if (job) {
            try {
              job.onDone(parsed.total);
            } catch (err) {
              console.warn(
                `[pdf-host] job.onDone threw: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
          dispatchNext();
          return;
        }
        case 'error': {
          failCurrent(new PdfRenderError(parsed.message));
          dispatchNext();
          return;
        }
      }
    },
    [dispatchNext, failCurrent]
  );

  if (!html) {
    return <View style={styles.host} pointerEvents="none" />;
  }

  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        ref={webviewRef}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        androidLayerType="software"
        onMessage={onMessage}
        onError={event => {
          const description = event.nativeEvent.description || 'WebView load error';
          failCurrent(new PdfRenderError(description));
        }}
        onHttpError={event => {
          const description = `WebView HTTP ${event.nativeEvent.statusCode}: ${event.nativeEvent.description ?? ''}`;
          failCurrent(new PdfRenderError(description));
        }}
        onRenderProcessGone={() => {
          guestReadyRef.current = false;
          failCurrent(new PdfRenderError('WebView render process terminated'));
        }}
      />
    </View>
  );
}

export default PdfRendererHost;

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden'
  }
});
