declare namespace MediaPipe {
  interface Point {
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }

  interface HandLandmark extends Point {}
  interface PoseLandmark extends Point {}

  interface HandsOptions {
    maxNumHands?: number;
    modelComplexity?: number;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
  }

  interface PoseOptions {
    modelComplexity?: number;
    smoothLandmarks?: boolean;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
  }

  interface HandsResults {
    multiHandLandmarks: HandLandmark[][];
  }

  interface PoseResults {
    poseLandmarks: PoseLandmark[];
  }

  interface Hands {
    new(config?: { locateFile?: (file: string) => string }): Hands;
    setOptions(options: HandsOptions): void;
    onResults(callback: (results: HandsResults) => void): void;
    send(config: { image: HTMLVideoElement }): Promise<void>;
  }

  interface Pose {
    new(config?: { locateFile?: (file: string) => string }): Pose;
    setOptions(options: PoseOptions): void;
    onResults(callback: (results: PoseResults) => void): void;
    send(config: { image: HTMLVideoElement }): Promise<void>;
  }
}

declare module '@mediapipe/hands' {
  const Hands: MediaPipe.Hands;
  export = Hands;
}

declare module '@mediapipe/pose' {
  const Pose: MediaPipe.Pose;
  export = Pose;
}

declare module '@mediapipe/drawing_utils' {
  export function drawConnectors(): void;
  export function drawLandmarks(): void;
}

declare module '@mediapipe/camera_utils' {
  export class Camera {
    constructor(config: { elementOrCanvas: HTMLCanvasElement | HTMLVideoElement });
    start(): Promise<void>;
  }
}
