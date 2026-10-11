/**
 * Gestor de Sensores de Ciclismo IoT via Web Bluetooth API.
 *
 * Suporta protocolos padronizados Bluetooth SIG:
 * - Cycling Power Service (0x1818 / 0x2A63): Potência em Watts
 * - Cycling Speed and Cadence (0x1816 / 0x2A5B): Cadência em RPM
 * - Heart Rate Service (0x180D / 0x2A37): Pulsação em BPM
 */
export class BleSensorManager {
  constructor() {
    this.powerWatts = null;
    this.cadenceRpm = null;
    this.heartRateBpm = null;
    this.deviceName = null;
    this.isConnected = false;
    this.device = null;
    this.server = null;
    this.onDataCallback = null;
    this.lastCrankRevs = null;
    this.lastCrankEventTime = null;
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect(onData = null) {
    if (!this.isSupported()) {
      throw new Error('A Web Bluetooth API não é suportada neste navegador. Utilize o Google Chrome, Edge ou Brave.');
    }

    this.onDataCallback = onData;

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['cycling_power'] },
          { services: ['cycling_speed_and_cadence'] },
          { services: ['heart_rate'] },
        ],
        optionalServices: ['cycling_power', 'cycling_speed_and_cadence', 'heart_rate', 'battery_service'],
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.isConnected = false;
        this.deviceName = null;
        this.powerWatts = null;
        this.cadenceRpm = null;
        if (this.onDataCallback) {
          this.onDataCallback({ connected: false });
        }
      });

      this.server = await this.device.gatt.connect();
      this.isConnected = true;
      this.deviceName = this.device.name || 'Sensor BLE';

      // 1. Conectar Serviço de Potência (Cycling Power)
      try {
        const powerService = await this.server.getPrimaryService('cycling_power');
        const powerChar = await powerService.getCharacteristic('cycling_power_measurement');
        await powerChar.startNotifications();
        powerChar.addEventListener('characteristicvaluechanged', (e) => {
          this.handlePowerData(e.target.value);
        });
      } catch (err) {
        console.log('Cycling Power Service não disponível:', err);
      }

      // 2. Conectar Serviço de Cadência (CSC)
      try {
        const cscService = await this.server.getPrimaryService('cycling_speed_and_cadence');
        const cscChar = await cscService.getCharacteristic('csc_measurement');
        await cscChar.startNotifications();
        cscChar.addEventListener('characteristicvaluechanged', (e) => {
          this.handleCscData(e.target.value);
        });
      } catch (err) {
        console.log('CSC Service não disponível:', err);
      }

      // 3. Conectar Serviço Cardíaco
      try {
        const hrService = await this.server.getPrimaryService('heart_rate');
        const hrChar = await hrService.getCharacteristic('heart_rate_measurement');
        await hrChar.startNotifications();
        hrChar.addEventListener('characteristicvaluechanged', (e) => {
          this.handleHeartRateData(e.target.value);
        });
      } catch (err) {
        console.log('Heart Rate Service não disponível:', err);
      }

      return { success: true, deviceName: this.deviceName };
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  handlePowerData(dataView) {
    // Especificação Bluetooth SIG: Flags (16-bit uint) nos bytes 0-1, Potência Instantânea (16-bit int) nos bytes 2-3
    if (dataView.byteLength >= 4) {
      this.powerWatts = dataView.getInt16(2, true); // Little-endian
      this.notifyUpdate();
    }
  }

  handleCscData(dataView) {
    if (dataView.byteLength < 1) return;
    const flags = dataView.getUint8(0);
    const hasCrankData = (flags & 0x02) !== 0;

    if (hasCrankData) {
      let offset = 1;
      const hasWheelData = (flags & 0x01) !== 0;
      if (hasWheelData) offset += 6; // Pular dados de roda (4 bytes rev + 2 bytes time)

      if (dataView.byteLength >= offset + 4) {
        const crankRevs = dataView.getUint16(offset, true);
        const crankEventTime = dataView.getUint16(offset + 2, true); // 1/1024s

        if (this.lastCrankEventTime !== null && crankEventTime !== this.lastCrankEventTime) {
          let timeDiff = (crankEventTime - this.lastCrankEventTime);
          if (timeDiff < 0) timeDiff += 65536; // Wrap 16-bit
          const timeSec = timeDiff / 1024;

          let revDiff = (crankRevs - this.lastCrankRevs);
          if (revDiff < 0) revDiff += 65536;

          if (timeSec > 0 && revDiff > 0) {
            this.cadenceRpm = Math.round((revDiff / timeSec) * 60);
          }
        }

        this.lastCrankRevs = crankRevs;
        this.lastCrankEventTime = crankEventTime;
        this.notifyUpdate();
      }
    }
  }

  handleHeartRateData(dataView) {
    if (dataView.byteLength < 2) return;
    const flags = dataView.getUint8(0);
    const is16Bit = (flags & 0x01) !== 0;
    this.heartRateBpm = is16Bit ? dataView.getUint16(1, true) : dataView.getUint8(1);
    this.notifyUpdate();
  }

  notifyUpdate() {
    if (this.onDataCallback) {
      this.onDataCallback({
        connected: this.isConnected,
        deviceName: this.deviceName,
        powerWatts: this.powerWatts,
        cadenceRpm: this.cadenceRpm,
        heartRateBpm: this.heartRateBpm,
      });
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
    this.deviceName = null;
    this.powerWatts = null;
    this.cadenceRpm = null;
    this.heartRateBpm = null;
  }
}

export const bleManager = new BleSensorManager();

