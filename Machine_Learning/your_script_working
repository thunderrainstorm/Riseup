from flask import Flask, jsonify
from flask_cors import CORS
import requests
import pandas as pd
import pickle
import joblib
import time
from datetime import datetime
import math
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for cross-origin requests from React Native

# ——— ESP32 HTTP endpoint ———
ESP32_IP = "192.168.213.84"  # Replace with your ESP32's IP
ESP_URL = f"http://{ESP32_IP}/data"

# ——— Load your trained model and scaler ———
try:
    with open('knn_model_all.pkl', 'rb') as f:
        model = pickle.load(f)
    scaler = joblib.load('data_scaler_all.pkl')
    model_loaded = True
except Exception as e:
    print(f"Error loading model: {e}")
    model_loaded = False

# ——— Define feature names and column order ———
feature_names = ["ax", "ay", "az", "droll", "dpitch", "dyaw", "w", "x", "y", "z"]
columns_in_order = ['w', 'x', 'y', 'z', 'droll', 'dpitch', 'dyaw', 'ax', 'ay', 'az']

# ——— Madgwick Filter Implementation ———
class MadgwickFilter:
    def __init__(self, sample_freq=50.0, beta=0.1):
        self.q0, self.q1, self.q2, self.q3 = 1.0, 0.0, 0.0, 0.0
        self.beta = beta
        self.sample_freq = sample_freq

    def update(self, gx, gy, gz, ax, ay, az):
        gx, gy, gz = map(math.radians, (gx, gy, gz))
        norm = math.sqrt(ax*ax + ay*ay + az*az)
        if norm == 0:
            return
        ax, ay, az = ax/norm, ay/norm, az/norm

        q0, q1, q2, q3 = self.q0, self.q1, self.q2, self.q3
        _2q0, _2q1, _2q2, _2q3 = 2*q0, 2*q1, 2*q2, 2*q3
        _4q0, _4q1, _4q2 = 4*q0, 4*q1, 4*q2
        _8q1, _8q2 = 8*q1, 8*q2
        q0q0, q1q1, q2q2, q3q3 = q0*q0, q1*q1, q2*q2, q3*q3

        s0 = _4q0*q2q2 + _2q2*ax + _4q0*q1q1 - _2q1*ay
        s1 = _4q1*q3q3 - _2q3*ax + 4*q0q0*q1 - _2q0*ay - _4q1 + _8q1*q1q1 + _8q1*q2q2 + _4q1*az
        s2 = 4*q0q0*q2 + _2q0*ax + _4q2*q3q3 - _2q3*ay - _4q2 + _8q2*q1q1 + _8q2*q2q2 + _4q2*az
        s3 = 4*q1q1*q3 - _2q1*ax + 4*q2q2*q3 - _2q2*ay

        norm_s = math.sqrt(s0*s0 + s1*s1 + s2*s2 + s3*s3)
        if norm_s == 0:
            return
        s0, s1, s2, s3 = s0/norm_s, s1/norm_s, s2/norm_s, s3/norm_s

        qDot0 = 0.5 * (-q1*gx - q2*gy - q3*gz) - self.beta * s0
        qDot1 = 0.5 * ( q0*gx + q2*gz - q3*gy) - self.beta * s1
        qDot2 = 0.5 * ( q0*gy - q1*gz + q3*gx) - self.beta * s2
        qDot3 = 0.5 * ( q0*gz + q1*gy - q2*gx) - self.beta * s3

        q0 += qDot0 / self.sample_freq
        q1 += qDot1 / self.sample_freq
        q2 += qDot2 / self.sample_freq
        q3 += qDot3 / self.sample_freq
        norm_q = math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3)
        if norm_q == 0:
            return
        self.q0, self.q1, self.q2, self.q3 = q0/norm_q, q1/norm_q, q2/norm_q, q3/norm_q

# Initialize Madgwick filter
madgwick = MadgwickFilter(sample_freq=50.0, beta=0.1)

# For storing last prediction to provide in case of connection issues
last_prediction = {
    "prediction": "Initializing...",
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
    "sensor_data": {
        "ax": 0.0, "ay": 0.0, "az": 1.0,
        "gx": 0.0, "gy": 0.0, "gz": 0.0,
        "quat": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}
    }
}

@app.route('/get_prediction', methods=['GET'])
def get_prediction():
    global last_prediction
    
    try:
        # Try to get data from ESP32
        resp = requests.get(ESP_URL, timeout=1.0)
        if resp.status_code != 200:
            return jsonify(last_prediction)
            
        data = resp.json()
        
        if "a" in data and "g" in data:
            ax, ay, az = data["a"]
            gx, gy, gz = data["g"]
            
            # Update orientation using Madgwick filter
            madgwick.update(gx, gy, gz, ax, ay, az)
            w, x, y, z = madgwick.q0, madgwick.q1, madgwick.q2, madgwick.q3
            
            # Use gyro values as rotation rates
            droll, dpitch, dyaw = gx, gy, gz
            
            # Build feature dictionary
            value_map = {
                "ax": ax, "ay": ay, "az": az,
                "droll": droll, "dpitch": dpitch, "dyaw": dyaw,
                "w": w, "x": x, "y": y, "z": z
            }
            
            # Prepare data for model prediction
            sensor_data = {
                "ax": round(ax, 3), 
                "ay": round(ay, 3), 
                "az": round(az, 3),
                "gx": round(gx, 2), 
                "gy": round(gy, 2), 
                "gz": round(gz, 2),
                "quat": {
                    "w": round(w, 3),
                    "x": round(x, 3),
                    "y": round(y, 3),
                    "z": round(z, 3)
                }
            }
            
            # Get current timestamp
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            
            # Make prediction if model is loaded
            if model_loaded:
                # Create DataFrame with all features
                test_df = pd.DataFrame([value_map])
                test_df.columns = feature_names
                
                # Reorder columns to match the model's expected input
                X_test = test_df[columns_in_order]
                
                # Scale and predict
                X_test_scaled = scaler.transform(X_test)
                predictions = model.predict(X_test_scaled)
                pred = predictions[0]
                
                # Format prediction for response
                if pred.startswith('fall'):
                    prediction = f"🚨 Fall Detected! {pred}"
                else:
                    prediction = f"Normal - {pred}"
            else:
                # If model not loaded, use fixed prediction for testing
                prediction = "Model not loaded - Using test data"
            
            # Create response object
            response = {
                "prediction": prediction,
                "timestamp": ts,
                "sensor_data": sensor_data
            }
            
            # Save this prediction as our last known good state
            last_prediction = response
            
            return jsonify(response)
        else:
            return jsonify({
                "error": "Incomplete data from ESP32",
                "last_prediction": last_prediction
            })
            
    except Exception as e:
        # Return last known good prediction in case of error
        return jsonify({
            "error": str(e),
            "last_prediction": last_prediction
        })

@app.route('/fixed_prediction', methods=['GET'])
def fixed_prediction():
    """Endpoint that always returns a fixed prediction (for testing)"""
    response = {
        "prediction": "🚨 Fall Detected! fall_forward",
        "timestamp": "2025-04-20 14:23:45.123",
        "sensor_data": {
            "ax": 0.012, 
            "ay": -0.034, 
            "az": 0.989,
            "gx": 0.50, 
            "gy": 1.20, 
            "gz": 0.10,
            "quat": { 
                "w": 0.998, 
                "x": 0.015, 
                "y": 0.010, 
                "z": 0.045 
            }
        }
    }
    
    return jsonify(response)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
