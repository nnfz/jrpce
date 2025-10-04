import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { appConfigDir, join } from "@tauri-apps/api/path";

export interface Role {
  id: string;
  name: string;
  color: string;
}

export interface Config {
  profile: {
    displayName: string;
    handleName: string;
    roles: Role[];
  };
  settings: {
    autoCheckInterval: number;
    isAutoChecking: boolean;
    // новое поле — тип активности для RPC
    activityType?: string;
  };
}

const defaultConfig: Config = {
  profile: {
    displayName: "Your Name",
    handleName: "@username",
    roles: []
  },
  settings: {
    autoCheckInterval: 5000,
    isAutoChecking: true,
    activityType: "playing"
  }
};

export async function loadConfig(): Promise<Config> {
  try {
    const dir = await appConfigDir();
    const path = await join(dir, "config.json");
    const content = await readTextFile(path);
    return JSON.parse(content) as Config;
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    const dir = await appConfigDir();
    const path = await join(dir, "config.json");

    // создаём директорию, если её нет
    await mkdir(dir, { recursive: true });

    await writeTextFile(path, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}
