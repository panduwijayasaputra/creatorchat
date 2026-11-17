/** What the dispatcher needs from a queue. The BullMQ adapter lives in the worker app. */
export interface JobQueue {
  /** Adding a job id that already exists must be a no-op (the id is the event id). */
  add(job: { jobId: string; name: string; data: { eventId: string } }): Promise<void>;
}
