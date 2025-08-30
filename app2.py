# app.py
from flask import Flask, render_template, Response
import cv2
import mediapipe as mp
import time

app = Flask(__name__)

# MediaPipe Pose and Hands setup
mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands
pose = mp_pose.Pose(
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7,
    model_complexity=2  # Using the most accurate model
)
hands = mp_hands.Hands(
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7,
    max_num_hands=1  # Track one hand for better performance
)
mp_drawing = mp.solutions.drawing_utils

# Global variables for calibration
keyboard_y = None
threshold_pixels = 20  # adjust for sensitivity
too_high_start = None
wrist_above_elbow_start = None
alert_time_seconds = 5  # trigger if too high for >5 sec
wrist_elbow_alert_seconds = 2  # trigger if wrist above elbow for >2 sec

# OpenCV video capture
cap = None

def ensure_camera():
    global cap
    if cap is None or not cap.isOpened():
        if cap is not None:
            cap.release()
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            raise RuntimeError("Could not open camera")
        # Set camera properties for better performance
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 30)

def gen_frames():
    global keyboard_y, too_high_start, wrist_above_elbow_start
    ensure_camera()
    while True:
        success, frame = cap.read()
        if not success:
            ensure_camera()
            continue

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pose_results = pose.process(frame_rgb)
        hand_results = hands.process(frame_rgb)

        h, w, _ = frame.shape

        # Process hand landmarks first
        if hand_results.multi_hand_landmarks:
            for hand_landmarks in hand_results.multi_hand_landmarks:
                # Draw all hand connections
                mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS,
                    mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=2),  # Landmarks
                    mp_drawing.DrawingSpec(color=(255, 255, 0), thickness=2)  # Connections
                )
                
                # Highlight knuckles specifically (indices 5,9,13,17 for knuckle row)
                knuckle_indices = [5, 9, 13, 17]  # MCP joints (knuckles)
                for idx in knuckle_indices:
                    knuckle = hand_landmarks.landmark[idx]
                    knuckle_xy = (int(knuckle.x * w), int(knuckle.y * h))
                    cv2.circle(frame, knuckle_xy, 4, (0, 0, 255), -1)  # Red dots for knuckles
                
        if pose_results.pose_landmarks:
            landmarks = pose_results.pose_landmarks.landmark

            # Get coordinates
            elbow = landmarks[mp_pose.PoseLandmark.RIGHT_ELBOW]

            # Convert to pixel coords
            elbow_xy = (int(elbow.x * w), int(elbow.y * h))

            # Draw circles for joints with larger radius and outline
            for point in [elbow_xy]:
                cv2.circle(frame, point, 8, (255,255,255), 2)  # White outline
                cv2.circle(frame, point, 6, (0,0,255), -1)     # Red center
                
            # Label the joints
            cv2.putText(frame, "Elbow", (elbow_xy[0] + 10, elbow_xy[1]),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 2)
            
            # Add text to indicate detection
            cv2.putText(frame, "Tracking Active", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)
            
            # Check if wrist is above elbow
            if hand_results.multi_hand_landmarks:
                wrist_y = int(hand_results.multi_hand_landmarks[0].landmark[0].y * h)
                elbow_y = int(elbow.y * h)
                
                # Draw a line between wrist and elbow
                if wrist_y < elbow_y:  # If wrist is higher than elbow (remember y is inverted)
                    if wrist_above_elbow_start is None:
                        wrist_above_elbow_start = time.time()
                    elif time.time() - wrist_above_elbow_start > wrist_elbow_alert_seconds:
                        cv2.putText(frame, "WRIST ABOVE ELBOW!", (50,100),
                                  cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 3)
                else:
                    wrist_above_elbow_start = None

            # Wrist Y check for calibration
            elbow_y = int(elbow.y * h)
            if keyboard_y is not None:
                if int(hand_landmarks.landmark[0].y * h) < elbow_y - threshold_pixels:
                    if too_high_start is None:
                        too_high_start = time.time()
                    elif time.time() - too_high_start > alert_time_seconds:
                        cv2.putText(frame, "WRIST TOO HIGH!", (50,50),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 3)
                else:
                    too_high_start = None
                # Draw keyboard reference line
                cv2.line(frame, (0, keyboard_y), (w, keyboard_y), (0,255,0), 2)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/')
def index():
    try:
        return render_template('index.html')
    except Exception as e:
        return f"<h1>Error loading template</h1><pre>{e}</pre>"




@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/calibrate/<int:y>')
def calibrate(y):
    global keyboard_y
    keyboard_y = y
    return f"Keyboard calibrated at y={y}"

if __name__ == '__main__':
    try:
        ensure_camera()  # Initialize camera before starting the app
        app.run(debug=True)
    finally:
        if cap is not None:
            cap.release()  # Properly release the camera when the app stops
