import { homedir } from 'os'
import { join } from 'path'

interface RuntimeApp {
  getPath: (name: string) => string
  getAppPath: () => string
  getVersion: () => string
  isPackaged: boolean
  commandLine: {
    appendSwitch: (name: string, value?: string) => void
  }
}

interface RuntimeSafeStorage {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

type ElectronLike = {
  app?: Partial<RuntimeApp>
  safeStorage?: Partial<RuntimeSafeStorage>
}

function loadElectron(): ElectronLike | null {
  try {
    if (typeof require !== 'function') {
      return null
    }

    const electron = require('electron') as ElectronLike
    if (electron?.app?.getPath) {
      return electron
    }
  } catch {
    // Running in plain Node.js mode.
  }

  return null
}

const electron = loadElectron()
const fallbackUserDataPath = process.env.CHAT2API_DATA_DIR || join(homedir(), '.chat2api')
const fallbackAppPath = process.cwd()
const fallbackVersion = process.env.npm_package_version || '1.2.0'

const fallbackApp: RuntimeApp = {
  getPath(name: string): string {
    if (name === 'userData') {
      return fallbackUserDataPath
    }
    return fallbackUserDataPath
  },
  getAppPath(): string {
    return fallbackAppPath
  },
  getVersion(): string {
    return fallbackVersion
  },
  isPackaged: false,
  commandLine: {
    appendSwitch(): void {
      // No-op outside Electron.
    },
  },
}

const fallbackSafeStorage: RuntimeSafeStorage = {
  isEncryptionAvailable(): boolean {
    return false
  },
  encryptString(value: string): Buffer {
    return Buffer.from(value, 'utf8')
  },
  decryptString(value: Buffer): string {
    return value.toString('utf8')
  },
}

export const runtimeApp: RuntimeApp = {
  getPath: electron?.app?.getPath ?? fallbackApp.getPath,
  getAppPath: electron?.app?.getAppPath ?? fallbackApp.getAppPath,
  getVersion: electron?.app?.getVersion ?? fallbackApp.getVersion,
  isPackaged: electron?.app?.isPackaged ?? fallbackApp.isPackaged,
  commandLine: {
    appendSwitch: electron?.app?.commandLine?.appendSwitch ?? fallbackApp.commandLine.appendSwitch,
  },
}

export const runtimeSafeStorage: RuntimeSafeStorage = {
  isEncryptionAvailable: electron?.safeStorage?.isEncryptionAvailable ?? fallbackSafeStorage.isEncryptionAvailable,
  encryptString: electron?.safeStorage?.encryptString ?? fallbackSafeStorage.encryptString,
  decryptString: electron?.safeStorage?.decryptString ?? fallbackSafeStorage.decryptString,
}

export default {
  app: runtimeApp,
  safeStorage: runtimeSafeStorage,
}
