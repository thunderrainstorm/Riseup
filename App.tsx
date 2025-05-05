import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  Platform,
  Linking,
  NativeModules,
  AppState,
  ScrollView,
  SafeAreaView,
  ActivityIndicator
} from 'react-native';

// ─── CONFIG ─────────────────────────────────────────────────────────────────────
const VERIFIED_NUMBERS = ['List of Contact Numbers'];
const OK_MESSAGE = "I'm safe and okay! [Auto Message]";
const SOS_MESSAGE = "EMERGENCY! Need help at my location: ";
const TWILIO_BACKEND_URL = 'https://final-2vmx.onrender.com';
const GEO_PAGE_URL = 'https://thunderrainstorm.github.io/emergency-map/get-location.html?redirect=myapp://callback';
const API_URL = 'http://192.168.181.210:5000/get_prediction';// ML
const ALERT_COOLDOWN = 180000;
// ────────────────────────────────────────────────────────────────────────────────

type SoundPlayerType = {
  playSound: (soundName: string) => Promise<void>;
  stopSound: () => Promise<void>;
  isPlaying: () => Promise<boolean>;
};

const SoundPlayer = NativeModules.SoundPlayer as SoundPlayerType;

interface SensorData {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  quat?: { w: number; x: number; y: number; z: number };
}

interface PredictionResponse {
  prediction: string;
  timestamp: string;
  sensor_data: SensorData;
}

export default function App() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [prediction, setPrediction] = useState<string>('Initializing...');
  const [timestamp, setTimestamp] = useState<string>('');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAlert, setAutoAlert] = useState<boolean>(false);
  const [autoAlertSent, setAutoAlertSent] = useState<boolean>(false);
  const [isAlarmOn, setIsAlarmOn] = useState<boolean>(false);
  const [lastAlertTime, setLastAlertTime] = useState<number>(0);

  const fetchPrediction = useCallback(async () => {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: PredictionResponse = await response.json();
      
      // Validate prediction before setting state
      const validatedPrediction = typeof data.prediction === 'string' 
        ? data.prediction 
        : 'Invalid prediction data';
      
      setPrediction(validatedPrediction);
      setTimestamp(data.timestamp || '');
      setSensorData(data.sensor_data || null);
      setLoading(false);
      setError(null);
      
      if (
        autoAlert && 
        validatedPrediction.includes("Fall Detected") && 
        Date.now() - lastAlertTime > ALERT_COOLDOWN && 
        !autoAlertSent
      ) {
        setLastAlertTime(Date.now());
        setAutoAlertSent(true);
        triggerEmergencyProtocol(true, `${SOS_MESSAGE} FALL DETECTED at ${data.timestamp}`);
        
        if (!isAlarmOn) {
          try {
            await SoundPlayer.playSound('help_sound');
            setIsAlarmOn(true);
          } catch (error) {
            Alert.alert('Sound Error', `Failed to start alarm: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [autoAlert, autoAlertSent, isAlarmOn, lastAlertTime]);

  useEffect(() => {
    fetchPrediction();
    const interval = setInterval(fetchPrediction, 1000);
    return () => clearInterval(interval);
  }, [fetchPrediction]);

  const handleDeepLink = useCallback((url: string | null) => {
    if (!url?.includes('myapp://callback')) return;
    try {
      const params = Object.fromEntries(
        url.split('?')[1]?.split('&').map(pair => pair.split('=')) || []
      );
      if (params.lat && params.lng) {
        onGotLocation(parseFloat(params.lat), parseFloat(params.lng));
      }
    } catch (error) {
      console.error('Deep link parsing error:', error);
    }
  }, []);

  useEffect(() => {
    const initialUrlHandler = async () => {
      const url = await Linking.getInitialURL();
      handleDeepLink(url);
    };
    initialUrlHandler();

    const linkingSubscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => linkingSubscription.remove();
  }, [handleDeepLink]);

  const onGotLocation = useCallback(async (lat: number, lng: number) => {
    try {
      const coordMessage = `${SOS_MESSAGE}Coordinates: ${lat},${lng}`;
      
      await Promise.all(VERIFIED_NUMBERS.map(number => 
        fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            to: number, 
            message: coordMessage
          })
        })
      ));

      if (isOnline) {
        const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
        try {
          await Promise.all(VERIFIED_NUMBERS.map(number =>
            fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: number,
                message: `${SOS_MESSAGE}Map: ${mapsUrl}`
              })
            })
          ));
          
          await Linking.openURL(mapsUrl);
        } catch (mapError) {
          console.log('Map link failed but coordinates sent');
        }
      }
      
      Alert.alert('Update Sent', 'Emergency alerts dispatched');
    } catch (error) {
      Alert.alert('Error', 'Failed to send location update');
    }
  }, [isOnline]);

  const triggerEmergencyAlerts = useCallback(async (message: string) => {
    try {
      await Promise.all(VERIFIED_NUMBERS.map(number =>
        fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: number, message })
        })
      ));
    } catch (error) {
      console.error('Alert error:', error);
      throw error;
    }
  }, []);

  const checkInternetConnection = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
      await fetch('https://www.google.com', { 
        method: 'HEAD',
        signal: controller.signal
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const handleAppResume = useCallback(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') {
        Linking.getInitialURL().then(url => url && handleDeepLink(url));
      }
    });
    return () => listener.remove();
  }, [handleDeepLink]);

  const triggerEmergencyProtocol = useCallback(async (skipConfirm = false, customMessage?: string) => {
    try {
      const isConnected = await checkInternetConnection();
      setIsOnline(isConnected);
      
      if (customMessage) {
        await triggerEmergencyAlerts(customMessage);
      } else {
        await triggerEmergencyAlerts(SOS_MESSAGE + '[Fetching location...]');
      }
      
      await fetch(`${TWILIO_BACKEND_URL}/start-conference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          numbers: VERIFIED_NUMBERS.slice(0, -1),
          userNumber: VERIFIED_NUMBERS[VERIFIED_NUMBERS.length - 1]
        })
      });
      
      setTimeout(() => Linking.openURL(GEO_PAGE_URL), 3000);
      handleAppResume();
      
      setAutoAlertSent(false);
    } catch (error) {
      Alert.alert('Error', 'Emergency protocol failed');
    }
  }, [triggerEmergencyAlerts, checkInternetConnection, handleAppResume]);

  const handleSOSPress = () => {
    Alert.alert('Confirm Emergency Alert', 'This will immediately notify emergency contacts', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm SOS', onPress: () => triggerEmergencyProtocol() }
    ]);
  };

  const handleOkayPress = useCallback(() => {
    Promise.all(VERIFIED_NUMBERS.map(number =>
      fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: number, message: OK_MESSAGE })
      })
    ))
    .then(() => Alert.alert('Status Sent', 'Safety confirmed'))
    .catch(() => Alert.alert('Error', 'Failed to send OK status'));
  }, []);

  const handleBuzzerPress = useCallback(async () => {
    try {
      if (isAlarmOn) {
        await SoundPlayer.stopSound();
        setIsAlarmOn(false);
        Alert.alert('Alarm Stopped', 'Distress signal deactivated');
      } else {
        await SoundPlayer.playSound('help_sound');
        setIsAlarmOn(true);
        Alert.alert('Alarm Activated', 'Distress signal sounding');
      }
    } catch (error) {
      try {
        const currentState = await SoundPlayer.isPlaying();
        setIsAlarmOn(currentState);
        Alert.alert(
          'Sound Error', 
          `Could not ${isAlarmOn ? 'stop' : 'start'} alarm: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (err) {
        Alert.alert('Sound Error', 'Failed to check alarm status');
      }
    }
  }, [isAlarmOn]);

  const toggleAutoAlert = () => {
    const newState = !autoAlert;
    setAutoAlert(newState);
    if (!newState && isAlarmOn) {
      handleBuzzerPress();
    }
    Alert.alert(
      'Auto Alert ' + (newState ? 'Enabled' : 'Disabled'),
      newState 
        ? 'Emergency contacts will be automatically notified if a fall is detected' 
        : 'Automatic fall notifications turned off'
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>🆘 Emergency Response System</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.okayButton} onPress={handleOkayPress}>
            <Text style={styles.buttonText}>I'm Safe</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.buzzerButton, isAlarmOn && styles.alarmActive]} 
            onPress={handleBuzzerPress}
          >
            <Text style={styles.buttonText}>
              {isAlarmOn ? 'Stop Alarm' : 'Sound Alarm'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.sosButton} onPress={handleSOSPress}>
            <Text style={styles.buttonText}>Emergency SOS</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.toggleButton, autoAlert ? styles.toggleActive : styles.toggleInactive]} 
            onPress={toggleAutoAlert}
          >
            <Text style={styles.buttonText}>
              {autoAlert ? "Auto-Alert ON" : "Auto-Alert OFF"}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.statusText, { color: isOnline ? 'green' : 'gray' }]}>
          {isOnline ? 'Online: Full alerts enabled' : 'Offline: Coordinates only'}
        </Text>

        {loading ? (
          <ActivityIndicator size="large" color="#0000ff" />
        ) : error ? (
          <Text style={styles.error}>Error: {error}</Text>
        ) : (
          <View style={styles.dataCard}>
            <View style={styles.predictionContainer}>
              <Text style={styles.dataHeader}>Current Status:</Text>
              <Text style={[
                styles.predictionText, 
                prediction && prediction.includes("Fall Detected") 
                  ? styles.alertText 
                  : {}
              ]}>
                {prediction}
              </Text>
              <Text style={styles.timestamp}>{timestamp}</Text>
            </View>

            {sensorData && (
              <View style={styles.sensorSection}>
                <Text style={styles.sensorTitle}>Sensor Data</Text>
                
                <View style={styles.sensorGrid}>
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Accel X:</Text>
                    <Text style={styles.sensorValue}>{sensorData.ax.toFixed(3)}</Text>
                  </View>
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Accel Y:</Text>
                    <Text style={styles.sensorValue}>{sensorData.ay.toFixed(3)}</Text>
                  </View>
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Accel Z:</Text>
                    <Text style={styles.sensorValue}>{sensorData.az.toFixed(3)}</Text>
                  </View>
                  
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Gyro X:</Text>
                    <Text style={styles.sensorValue}>{sensorData.gx.toFixed(3)}</Text>
                  </View>
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Gyro Y:</Text>
                    <Text style={styles.sensorValue}>{sensorData.gy.toFixed(3)}</Text>
                  </View>
                  <View style={styles.sensorRow}>
                    <Text style={styles.sensorLabel}>Gyro Z:</Text>
                    <Text style={styles.sensorValue}>{sensorData.gz.toFixed(3)}</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollContent: {
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#2c3e50',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  okayButton: {
    backgroundColor: '#27ae60',
    padding: 16,
    borderRadius: 10,
    flex: 1,
    elevation: 3,
  },
  buzzerButton: {
    backgroundColor: '#e67e22',
    padding: 16,
    borderRadius: 10,
    flex: 1,
    elevation: 3,
  },
  alarmActive: {
    backgroundColor: '#c0392b',
  },
  sosButton: {
    backgroundColor: '#e74c3c',
    padding: 16,
    borderRadius: 10,
    flex: 1,
    elevation: 3,
  },
  toggleButton: {
    padding: 16,
    borderRadius: 10,
    flex: 1,
    elevation: 2,
  },
  toggleActive: {
    backgroundColor: '#2980b9',
  },
  toggleInactive: {
    backgroundColor: '#7f8c8d',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  statusText: {
    fontSize: 14,
    marginVertical: 12,
    textAlign: 'center',
  },
  dataCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  predictionContainer: {
    marginBottom: 16,
  },
  dataHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  predictionText: {
    fontSize: 16,
    color: '#34495e',
    marginBottom: 4,
  },
  alertText: {
    color: '#c0392b',
    fontWeight: 'bold',
  },
  timestamp: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  sensorSection: {
    marginTop: 12,
  },
  sensorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 12,
  },
  sensorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sensorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ecf0f1',
    padding: 12,
    borderRadius: 8,
    flexBasis: '48%',
  },
  sensorLabel: {
    fontSize: 14,
    color: '#34495e',
  },
  sensorValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
  },
  error: {
    color: '#c0392b',
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 20,
  },
});
