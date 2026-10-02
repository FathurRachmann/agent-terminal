/**
 * Minimal next/server shim so copied route handlers run under plain Node.
 */
export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers || {});
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers,
    });
  }

  static redirect(url, status = 307) {
    return new NextResponse(null, {
      status,
      headers: { Location: String(url) },
    });
  }

  static next() {
    return new NextResponse(null, { status: 200 });
  }
}

export function after() {
  /* no-op in Agent host */
}
