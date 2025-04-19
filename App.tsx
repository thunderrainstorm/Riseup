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
  ScrollView
} from 'react-native';

// ─── CONFIG ─────────────────────────────────────────────────────────────────────
const VERIFIED_NUMBERS = ['emergency contact number'];
const OK_MESSAGE = "I'm safe and okay! [Auto Message]";
const SOS_MESSAGE = "EMERGENCY! Need help at my location: ";
const TWILIO_BACKEND_URL = 'ur twilio delpoyed on render url';
const GEO_PAGE_URL = 'https://thunderrainstorm.github.io/emergency-map/get-location.html?redirect=myapp://callback';
const ESP32_IP = 'current ip of esp32 which is on the same network with mobile';
const POLL_INTERVAL_MS = 500;
// ────────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [sensorData, setSensorData] = useState<{ a: number[]; g: number[] } | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [autoAlertSent, setAutoAlertSent] = useState<boolean>(false);

  const fetchSensorData = useCallback(async () => {
    try {
      const response = await fetch(`${ESP32_IP}/data`);
      if (!response.ok) throw new Error('Failed to fetch sensor data');
      const data = await response.json();
      setSensorData(data);
    } catch (error) {
      console.error('Sensor data error:', error);
      Alert.alert('Sensor Error', 'Failed to get sensor data. Check device connection.');
    }
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (isPolling) {
      fetchSensorData();
      intervalId = setInterval(fetchSensorData, POLL_INTERVAL_MS);
    }
    return () => clearInterval(intervalId);
  }, [isPolling, fetchSensorData]);

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
      await fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          to: VERIFIED_NUMBERS[0], 
          message: coordMessage
        })
      });

      if (isOnline) {
        const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
        try {
          await Promise.all([
            fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: VERIFIED_NUMBERS[0],
                message: `${SOS_MESSAGE}Map: ${mapsUrl}`
              })
            }),
            Linking.openURL(mapsUrl)
          ]);
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
      await Promise.all([
        fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: VERIFIED_NUMBERS[0], message })
        }),
        fetch(`${TWILIO_BACKEND_URL}/make-call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: VERIFIED_NUMBERS[0] })
        })
      ]);
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
        listener.remove();
      }
    });
  }, [handleDeepLink]);

  const triggerEmergencyProtocol = useCallback(async () => {
    try {
      await triggerEmergencyAlerts(SOS_MESSAGE + '[Fetching location...]');
      const isConnected = await checkInternetConnection();
      setIsOnline(isConnected);
      await Linking.openURL(GEO_PAGE_URL);
      handleAppResume();
    } catch {
      Alert.alert('Error', 'Emergency protocol failed');
    }
  }, [triggerEmergencyAlerts, checkInternetConnection, handleAppResume]);

  const handleSOSPress = () => {
    Alert.alert('Confirm Emergency Alert', 'This will immediately notify emergency contacts', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm SOS', onPress: triggerEmergencyProtocol }
    ]);
  };

  const handleOkayPress = useCallback(() => {
    fetch(`${TWILIO_BACKEND_URL}/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: VERIFIED_NUMBERS[0], message: OK_MESSAGE })
    })
    .then(() => Alert.alert('Status Sent', 'Safety confirmed'))
    .catch(() => Alert.alert('Error', 'Failed to send OK status'));
  }, []);

  const handleBuzzerPress = useCallback(() => {
    try {
      if (Platform.OS === 'android') {
        (NativeModules as any).SoundPlayer.playSound('help_sound');
      }
      Alert.alert('Audible Alert', 'Distress signal activated');
    } catch {
      Alert.alert('Error', 'Could not activate sound system');
    }
  }, []);

  const calculateFallStatus = useCallback(() => {
    if (!sensorData) return { smv: 0, fallDetected: false };
    
    const [ax, ay, az] = sensorData.a;
    const smv = Math.sqrt(ax ** 2 + ay ** 2 + az ** 2);
    const fallDetected = smv < 0.5 || smv > 3.0;
    
    return { smv, fallDetected };
  }, [sensorData]);

  const { smv, fallDetected } = calculateFallStatus();

  useEffect(() => {
    if (fallDetected && isPolling && !autoAlertSent) {
      setIsPolling(false);
      setAutoAlertSent(true);
      triggerEmergencyProtocol();
    }
  }, [fallDetected, isPolling, autoAlertSent, triggerEmergencyProtocol]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity style={styles.okayButton} onPress={handleOkayPress}>
          <Text style={styles.buttonText}>I'm Safe</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.buzzerButton} onPress={handleBuzzerPress}>
          <Text style={styles.buttonText}>Sound Alarm</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.sosButton} onPress={handleSOSPress}>
          <Text style={styles.buttonText}>Emergency SOS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sensorButton, isPolling && styles.activePolling]}
          onPress={() => {
            setIsPolling(!isPolling);
            setAutoAlertSent(false);
          }}
        >
          <Text style={styles.buttonText}>
            {isPolling ? 'Stop Sensor Polling' : 'Start Sensor Polling'}
          </Text>
        </TouchableOpacity>

        {sensorData && (
          <View style={styles.dataContainer}>
            <Text style={styles.dataHeader}>Sensor Readings:</Text>
            <Text style={styles.dataText}>
              Acceleration (m/s²):{'\n'}
              X: {sensorData.a[0].toFixed(4)}{'\n'}
              Y: {sensorData.a[1].toFixed(4)}{'\n'}
              Z: {sensorData.a[2].toFixed(4)}
            </Text>
            <Text style={styles.dataText}>
              Gyroscope (rad/s):{'\n'}
              X: {sensorData.g[0].toFixed(4)}{'\n'}
              Y: {sensorData.g[1].toFixed(4)}{'\n'}
              Z: {sensorData.g[2].toFixed(4)}
            </Text>
            <Text style={fallDetected ? styles.fallText : styles.noFallText}>
              {fallDetected ? 'Fall Detected!' : 'No Fall Detected'}
            </Text>
            <Text style={styles.dataText}>SMV: {smv.toFixed(4)}</Text>
          </View>
        )}

        <Text style={[styles.statusText, { color: isOnline ? 'green' : 'gray' }]}>
          {isOnline ? 'Online: Full alerts enabled' : 'Offline: Coordinates only'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0'
  },
  scrollContent: {
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dataContainer: {
    width: '90%',
    marginTop: 20,
    padding: 15,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    elevation: 3
  },
  dataHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12
  },
  dataText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20
  },
  fallText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F44336',
    marginTop: 12,
    textAlign: 'center'
  },
  noFallText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginTop: 12,
    textAlign: 'center'
  },
  sensorButton: {
    backgroundColor: '#3F51B5',
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
    elevation: 2
  },
  activePolling: {
    backgroundColor: '#2196F3'
  },
  okayButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 15,
    marginVertical: 8,
    width: '80%',
    elevation: 3
  },
  buzzerButton: {
    backgroundColor: '#FF9800',
    padding: 20,
    borderRadius: 15,
    marginVertical: 8,
    width: '80%',
    elevation: 3
  },
  sosButton: {
    backgroundColor: '#F44336',
    padding: 20,
    borderRadius: 15,
    marginVertical: 8,
    width: '80%',
    elevation: 3
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  statusText: {
    fontSize: 12,
    color: '#666',
    marginTop: 20,
    textAlign: 'center'
  }
});