// Secret bindings are not emitted by `wrangler types`; declare them here.
declare namespace Cloudflare {
  interface Env {
    /**
     * Shared with the API's EDGE_PROXY_SHARED_SECRET
     * (`wrangler secret put EDGE_PROXY_SHARED_SECRET --env production`).
     * Optional so the Worker keeps proxying before the secret is provisioned.
     */
    EDGE_PROXY_SHARED_SECRET?: string;
  }
}
