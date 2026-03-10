import { PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';

export interface PrinterDevice {
    name: string;
    address: string;
}

// Lazy load libraries to prevent crash on import
let BluetoothManager: any = null;
let BluetoothEscposPrinter: any = null;

const isExpoGo = () => {
    return Constants.appOwnership === 'expo';
};

const initLib = () => {
    if (BluetoothManager) return true;
    if (isExpoGo()) {
        console.warn('Printer usage detected in Expo Go. Native modules are not supported.');
        return false;
    }
    try {
        const lib = require('react-native-bluetooth-escpos-printer');
        BluetoothManager = lib.BluetoothManager;
        BluetoothEscposPrinter = lib.BluetoothEscposPrinter;
        
        if (!BluetoothManager) {
            console.error('Module BluetoothManager is null after require');
            return false;
        }
        return true;
    } catch (e) {
        console.error('Failed to load react-native-bluetooth-escpos-printer:', e);
        return false;
    }
};

class PrinterService {
    private connectedDevice: PrinterDevice | null = null;

    checkEnvironment() {
        if (isExpoGo()) {
            return {
                ok: false,
                msg: 'Debes usar un "Development Build" (no Expo Go) para usar la impresora.'
            };
        }
        if (!initLib()) {
            return {
                ok: false,
                msg: 'El módulo nativo de Bluetooth no está cargado. Reinstala la app con npx expo run:android.'
            };
        }
        return { ok: true, msg: 'Entorno correcto.' };
    }

    async requestPermissions() {
        if (Platform.OS === 'android') {
            const apiLevel = Platform.Version as number;
            
            // Location is required for scanning on Android
            const locationGranted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: 'Permiso de Ubicación',
                    message: 'Android requiere ubicación para encontrar dispositivos Bluetooth.',
                    buttonPositive: 'OK',
                }
            );

            if (locationGranted !== PermissionsAndroid.RESULTS.GRANTED) return false;

            if (apiLevel >= 31) {
                const scanGranted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
                );
                const connectGranted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
                );
                return (
                    scanGranted === PermissionsAndroid.RESULTS.GRANTED &&
                    connectGranted === PermissionsAndroid.RESULTS.GRANTED
                );
            }
        }
        return true;
    }

    async enableBluetooth() {
        if (!initLib()) return false;
        try {
            return await BluetoothManager.enableBluetooth();
        } catch (e) {
            console.error('enableBluetooth error:', e);
            return false;
        }
    }

    async scanDevices(): Promise<PrinterDevice[]> {
        if (!initLib()) return [];
        try {
            console.log('Starting Bluetooth scan...');
            const devicesString = await BluetoothManager.scanDevices();
            console.log('Scan result:', devicesString);
            const devices = JSON.parse(devicesString);
            const found = devices.found || [];
            const coupled = devices.paired || [];
            
            const all = [...found, ...coupled].map((d: any) => ({
                name: d.name || 'Dispositivo Desconocido',
                address: d.address
            }));

            return Array.from(new Map(all.map(item => [item.address, item])).values());
        } catch (e) {
            console.error('Error scanning devices:', e);
            return [];
        }
    }

    async connect(address: string, name: string) {
        if (!initLib()) return false;
        try {
            await BluetoothManager.connect(address);
            this.connectedDevice = { address, name };
            return true;
        } catch (e) {
            console.error('Error connecting to printer:', e);
            return false;
        }
    }

    async printTest() {
        if (!initLib() || !this.connectedDevice) return false;
        try {
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();

            const zpl = `^XA
^FO50,50^A0N,60,60^FDConectado^FS
^FO50,130^A0N,35,35^FDFec: ${dateStr}^FS
^FO50,180^A0N,35,35^FDHora: ${timeStr}^FS
^XZ`;

            await BluetoothEscposPrinter.printRawData(zpl, {});
            return true;
        } catch (e) {
            console.error('Error printing test:', e);
            return false;
        }
    }

    getConnectedDevice() {
        return this.connectedDevice;
    }

    async isBluetoothEnabled() {
        if (!initLib()) return false;
        try {
            return await BluetoothManager.isBluetoothEnabled();
        } catch (e) {
            return false;
        }
    }
}

export const printerService = new PrinterService();
