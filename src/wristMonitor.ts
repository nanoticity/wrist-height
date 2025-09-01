interface Window {
  Hands: MediaPipe.Hands;
  Pose: MediaPipe.Pose;
  webkitAudioContext: typeof AudioContext;
}

interface Vector2D {
  x: number;
  y: number;
}

class WristMonitor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private status: HTMLElement;
  private video: HTMLVideoElement;
  private hands?: MediaPipe.Hands;
  private pose?: MediaPipe.Pose;
  private audioContext: AudioContext;
  
  private handLandmarks: MediaPipe.HandLandmark[][] | null = null;
  private poseLandmarks: MediaPipe.PoseLandmark[] | null = null;
  private wristTooHighStart: number | null = null;
  private lastBeepTime: number | null = null;
  
  private readonly ALERT_DELAY = 2000; // 2 seconds in milliseconds
  private readonly BEEP_INTERVAL = 2000; // Time between beeps

  constructor() {
    const canvasElement = document.getElementById('canvas');
    const statusElement = document.getElementById('status');
    
    if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
      throw new Error('Canvas element not found');
    }
    if (!statusElement) {
      throw new Error('Status element not found');
    }

    this.canvas = canvasElement;
    this.status = statusElement;
    
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = context;

    this.video = document.createElement('video');
    this.video.width = 640;
    this.video.height = 480;
    this.video.autoplay = true;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    this.initializeMediaPipe();
    this.setupCamera();
    this.setupEventListeners();
  }

  private initializeMediaPipe(): void {
    try {
      this.hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
        }
      });
      
      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.hands.onResults(this.onResultsHands.bind(this));
    } catch (error) {
      console.error('Error initializing MediaPipe Hands:', error);
      this.status.innerText = 'Error initializing hand tracking';
    }

    try {
      this.pose = new window.Pose({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`;
        }
      });

      this.pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.pose.onResults(this.onResultsPose.bind(this));
    } catch (error) {
      console.error('Error initializing MediaPipe Pose:', error);
      this.status.innerText = 'Error initializing pose tracking';
    }
  }

  private async setupCamera(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.video.srcObject = stream;
      this.video.onloadedmetadata = () => {
        this.video.play();
        this.startDetection();
      };
    } catch (error) {
      console.error('Error accessing camera:', error);
      this.status.innerText = 'Error accessing camera';
    }
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('click', () => {
      try {
        this.audioContext.resume();
        this.status.innerText = 'Audio enabled - monitoring wrist angle';
      } catch (error) {
        console.error('Error initializing audio:', error);
        this.status.innerText = 'Error enabling audio';
      }
    });
  }

  private playBeep(): void {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.value = 440; // A4 note
    gainNode.gain.value = 0.1; // Lower volume

    oscillator.start();
    setTimeout(() => oscillator.stop(), 200); // Short beep
  }

  private angleBetween(v1: Vector2D, v2: Vector2D): number {
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.hypot(v1.x, v1.y);
    const mag2 = Math.hypot(v2.x, v2.y);
    let cosA = dot / (mag1 * mag2);
    cosA = Math.max(-1, Math.min(1, cosA));
    const angle = Math.acos(cosA) * 180 / Math.PI;
    const cross = v1.x * v2.y - v1.y * v2.x;
    return cross < 0 ? -angle : angle;
  }

  private drawLandmarks(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    if (this.poseLandmarks && this.poseLandmarks.length > 0) {
      // Right elbow is landmark 14
      const elbow = this.poseLandmarks[14];
      this.ctx.fillStyle = 'red';
      this.ctx.beginPath();
      this.ctx.arc(elbow.x * this.canvas.width, elbow.y * this.canvas.height, 8, 0, 2 * Math.PI);
      this.ctx.fill();
      this.ctx.fillStyle = 'white';
      this.ctx.font = '16px Arial';
      this.ctx.fillText('Elbow', elbow.x * this.canvas.width + 10, elbow.y * this.canvas.height);
    }

    if (this.handLandmarks && this.handLandmarks.length > 0) {
      const landmarks = this.handLandmarks[0];
      
      // Draw knuckles
      [5, 9, 13, 17].forEach(i => {
        const lm = landmarks[i];
        this.ctx.fillStyle = 'blue';
        this.ctx.beginPath();
        this.ctx.arc(lm.x * this.canvas.width, lm.y * this.canvas.height, 5, 0, 2 * Math.PI);
        this.ctx.fill();
      });

      // Calculate and display wrist angle
      if (this.poseLandmarks && this.poseLandmarks.length > 0) {
        const elbow = this.poseLandmarks[14];  // Right elbow
        const wrist = landmarks[0];
        const indexMCP = landmarks[5];

        const forearm: Vector2D = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
        const handVec: Vector2D = { x: indexMCP.x - wrist.x, y: indexMCP.y - wrist.y };
        const wristAngle = -this.angleBetween(forearm, handVec);

        this.ctx.fillStyle = 'yellow';
        this.ctx.font = 'bold 24px Arial';
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 2;
        const text = `Wrist Angle: ${Math.round(wristAngle)}°`;
        this.ctx.strokeText(text, 50, 50);
        this.ctx.fillText(text, 50, 50);

        // Alert for wrist angle
        const currentTime = Date.now();
        if (wristAngle < 5) {  // If wrist angle is too low
          // Start or continue timing
          if (this.wristTooHighStart === null) {
            this.wristTooHighStart = currentTime;
          } else if (currentTime - this.wristTooHighStart >= this.ALERT_DELAY) {
            // After 2-second delay, show warning and beep
            this.ctx.fillStyle = 'red';
            const alertText = 'Wrist Too Low!';
            this.ctx.strokeText(alertText, 50, 80);
            this.ctx.fillText(alertText, 50, 80);
            
            // Play beep if enough time has passed since last beep
            if (this.lastBeepTime === null || currentTime - this.lastBeepTime >= this.BEEP_INTERVAL) {
              this.playBeep();
              this.lastBeepTime = currentTime;
            }
          }
        } else {
          // Wrist angle is OK
          this.wristTooHighStart = null;
          this.ctx.fillStyle = 'lime';
          const okText = 'Wrist OK';
          this.ctx.strokeText(okText, 50, 80);
          this.ctx.fillText(okText, 50, 80);
        }
      }
    }
  }

  private onResultsHands(results: MediaPipe.HandsResults): void {
    this.handLandmarks = results.multiHandLandmarks;
    this.drawLandmarks();
  }

  private onResultsPose(results: MediaPipe.PoseResults): void {
    this.poseLandmarks = results.poseLandmarks;
    this.drawLandmarks();
  }

  private async startDetection(): Promise<void> {
    const detectFrame = async (): Promise<void> => {
      try {
        if (!this.video.paused && !this.video.ended) {
          if (this.hands && this.pose) {
            await this.hands.send({ image: this.video });
            await this.pose.send({ image: this.video });
          }
        }
        requestAnimationFrame(() => detectFrame());
      } catch (error) {
        console.error('Error in detection loop:', error);
        this.status.innerText = 'Detection error - please refresh the page';
      }
    };
    detectFrame();
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new WristMonitor();
});
