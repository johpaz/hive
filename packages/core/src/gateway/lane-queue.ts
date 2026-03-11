export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  sessionId: string;
  status: TaskStatus;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  abortController: AbortController;
}

export interface LaneQueueOptions {
  maxConcurrency?: number;
  taskTimeoutMs?: number;
}

type TaskHandler<T> = (task: Task, signal: AbortSignal) => Promise<T>;

export class LaneQueue {
  private queues: Map<string, Task[]> = new Map();
  private running: Map<string, Task> = new Map();
  private handlers: Map<string, TaskHandler<unknown>> = new Map();
  private taskIdCounter = 0;
  private options: Required<LaneQueueOptions>;

  constructor(options: LaneQueueOptions = {}) {
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 1,
      taskTimeoutMs: options.taskTimeoutMs ?? 300000,
    };
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${++this.taskIdCounter}`;
  }

  private getQueue(sessionId: string): Task[] {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = [];
      this.queues.set(sessionId, queue);
    }
    return queue;
  }

  enqueue<T>(
    sessionId: string,
    handler: TaskHandler<T>,
    priority = 0
  ): Task {
    const task: Task = {
      id: this.generateTaskId(),
      sessionId,
      status: "pending",
      priority,
      createdAt: new Date(),
      abortController: new AbortController(),
    };

    this.handlers.set(task.id, handler as TaskHandler<unknown>);

    const queue = this.getQueue(sessionId);
    queue.push(task);
    queue.sort((a, b) => b.priority - a.priority);

    this.processQueue(sessionId);

    return task;
  }

  private async processQueue(sessionId: string): Promise<void> {
    const running = this.running.get(sessionId);
    if (running) {
      return;
    }

    const queue = this.getQueue(sessionId);
    if (queue.length === 0) {
      return;
    }

    const task = queue.shift();
    if (!task) return;

    task.status = "running";
    task.startedAt = new Date();
    this.running.set(sessionId, task);

    const handler = this.handlers.get(task.id);

    const timeoutId = setTimeout(() => {
      task.abortController.abort();
    }, this.options.taskTimeoutMs);

    try {
      if (handler) {
        await handler(task, task.abortController.signal);
      }
      task.status = "completed";
      task.completedAt = new Date();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        task.status = "cancelled";
      } else {
        task.status = "failed";
        task.error = (error as Error).message;
      }
      task.completedAt = new Date();
    } finally {
      clearTimeout(timeoutId);
      this.running.delete(sessionId);
      this.handlers.delete(task.id);
      
      if (queue.length > 0) {
        this.processQueue(sessionId);
      }
    }
  }

  cancel(sessionId: string): boolean {
    const task = this.running.get(sessionId);
    if (task) {
      task.abortController.abort();
      return true;
    }

    const queue = this.getQueue(sessionId);
    const index = queue.findIndex((t) => t.status === "pending");
    if (index >= 0) {
      const cancelled = queue.splice(index, 1)[0];
      if (cancelled) {
        cancelled.status = "cancelled";
        cancelled.completedAt = new Date();
      }
      return true;
    }

    return false;
  }

  getStatus(sessionId: string): {
    queueLength: number;
    running?: Task;
  } {
    const queue = this.getQueue(sessionId);
    const running = this.running.get(sessionId);

    return {
      queueLength: queue.length,
      running,
    };
  }

  isProcessing(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  prune(sessionId: string): void {
    const queue = this.getQueue(sessionId);
    if (queue.length === 0 && !this.running.has(sessionId)) {
      this.queues.delete(sessionId);
    }
  }
}

export const laneQueue = new LaneQueue();
