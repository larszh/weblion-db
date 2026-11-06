/**
 * Opens the assistant from elsewhere on the page (the organization dashboard's "KI-Assistent fragen" and its
 * suggestions, ai 12.5). The panel registers itself while it is mounted; without it the call does nothing.
 */
export interface AssistantRequest {
  /** Sent right away as the next question. */
  question?: string;
}

let listener: ((request: AssistantRequest) => void) | null = null;

export function setAssistantListener(next: ((request: AssistantRequest) => void) | null): void {
  listener = next;
}

export function openAssistant(request: AssistantRequest = {}): void {
  listener?.(request);
}
