// Shared safe error contract; no credentials or application services.
export class SafeError extends Error { constructor(status, code) { super(code); this.status=status; this.code=code; } }
