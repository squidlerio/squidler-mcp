import * as http from "http";

export interface CallbackResult {
  code: string;
  state: string;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Authentication Successful</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>Authenticated!</h1><p>You can close this tab and return to your terminal.</p></div>
</body></html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html><head><title>Authentication Failed</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>Authentication Failed</h1><p>${msg}</p></div>
</body></html>`;

export function startCallbackServer(): Promise<{
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let onResult: (result: CallbackResult) => void;
    let onError: (err: Error) => void;

    const resultPromise = new Promise<CallbackResult>((res, rej) => {
      onResult = res;
      onError = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(desc));
        onError(new Error(`OAuth error: ${desc}`));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(ERROR_HTML("Missing code or state parameter"));
        onError(new Error("Missing code or state in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
      onResult({ code, state });
    });

    server.unref();

    const timeout = setTimeout(() => {
      server.close();
      onError(new Error("Authentication timed out (5 minutes)"));
    }, 5 * 60 * 1000);

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not get callback server port"));
        return;
      }

      resolve({
        port: address.port,
        waitForCallback: () => resultPromise,
        close: () => {
          clearTimeout(timeout);
          server.close();
        },
      });
    });
  });
}
