declare module '@novnc/novnc' {
  export interface RFBOptions {
    credentials?: { username?: string; password?: string; target?: string };
    wsProtocols?: string[];
    shared?: boolean;
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    background: string;
    disconnect(): void;
    sendCtrlAltDel(): void;
    focus(): void;
    addEventListener(type: 'connect', listener: () => void): void;
    addEventListener(type: 'disconnect', listener: (e: CustomEvent<{ clean: boolean }>) => void): void;
    addEventListener(
      type: 'securityfailure',
      listener: (e: CustomEvent<{ status: number; reason?: string }>) => void,
    ): void;
    addEventListener(type: string, listener: (e: CustomEvent) => void): void;
  }
}
