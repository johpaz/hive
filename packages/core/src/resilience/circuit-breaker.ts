import { logger } from "../utils/logger.ts";

type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

const defaultOptions: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeout: 30000,
  halfOpenMaxCalls: 1,
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private halfOpenCalls = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = defaultOptions
  ) { }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime ?? 0);

      if (timeSinceLastFailure > this.options.resetTimeout) {
        this.transitionTo("half-open");
      } else {
        const waitTime = this.options.resetTimeout - timeSinceLastFailure;
        throw new CircuitBreakerOpenError(
          `Circuit breaker '${this.name}' is OPEN. Retry in ${Math.ceil(waitTime / 1000)}s`,
          this.name,
          waitTime
        );
      }
    }

    if (this.state === "half-open") {
      if (this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
        throw new CircuitBreakerOpenError(
          `Circuit breaker '${this.name}' is HALF-OPEN with pending calls`,
          this.name,
          0
        );
      }
      this.halfOpenCalls++;
    }

    this.totalCalls++;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.totalSuccesses++;
    this.failures = 0;

    if (this.state === "half-open") {
      this.successes++;
      this.halfOpenCalls--;

      if (this.successes >= this.options.successThreshold) {
        this.transitionTo("closed");
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.totalFailures++;
    this.failures++;

    if (this.state === "half-open") {
      this.halfOpenCalls--;
      this.transitionTo("open");
    } else if (this.state === "closed") {
      if (this.failures >= this.options.failureThreshold) {
        this.transitionTo("open");
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === "closed") {
      this.failures = 0;
      this.successes = 0;
      this.halfOpenCalls = 0;
    } else if (newState === "open") {
      this.successes = 0;
      this.halfOpenCalls = 0;
    }

    this.options.onStateChange?.(oldState, newState);
    logger.info(`[CircuitBreaker] ${this.name}: ${oldState} → ${newState}`);
  }

  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  isClosed(): boolean {
    return this.state === "closed";
  }

  isHalfOpen(): boolean {
    return this.state === "half-open";
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  reset(): void {
    this.transitionTo("closed");
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.halfOpenCalls = 0;
  }

  forceOpen(): void {
    this.transitionTo("open");
    this.lastFailureTime = Date.now();
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  getOrCreate(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    let breaker = this.breakers.get(name);

    if (!breaker) {
      breaker = new CircuitBreaker(name, { ...defaultOptions, ...options });
      this.breakers.set(name, breaker);
    }

    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
